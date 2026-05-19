"""6 个 Function Calling Tools。

每个 tool 含两部分：
- TOOL_SCHEMAS 里的 OpenAI 标准格式定义（让 LLM 看）
- impl 函数（实际执行）

通过 TOOL_DISPATCH 字典调度。所有 impl 接收 (args: dict, ctx: dict) → result: dict
ctx 包含：pet_id / image_path / session / vlm_task
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from sqlmodel import Session, select

from app.db.models import Pet, PetEvent, Reminder, Reminder
from app.rag.retriever import get_retriever

load_dotenv()


# ============ TOOL SCHEMAS (for LLM tools API) ============

TOOL_SCHEMAS = [
    {
        'type': 'function',
        'function': {
            'name': 'retrieve_vet_knowledge',
            'description': '在 PetPal 兽医知识库（约 130 条同行评议条目）中检索相关知识。'
                           '用于回答医学/护理/疫苗/急救/品种等问题。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {'type': 'string', 'description': '检索查询文本'},
                    'top_k': {'type': 'integer', 'description': '返回条数', 'default': 5},
                    'species': {
                        'type': 'string',
                        'enum': ['cat', 'dog'],
                        'description': '限定物种（不传则不限）',
                    },
                    'emergency_only': {
                        'type': 'boolean',
                        'description': '只检索急诊红线条目',
                        'default': False,
                    },
                },
                'required': ['query'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'query_pet_history',
            'description': '查询某宠物的历史事件（BCS / 症状 / 疫苗 / 体重等）。'
                           '已经在 system context 给你过最近 5 条，仅当需要按 type 或更早历史时调用。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'pet_id': {'type': 'integer', 'description': '宠物 ID'},
                    'event_type': {
                        'type': 'string',
                        'description': 'bcs / symptom / vaccine / weight / emotion / pain_fgs 等',
                    },
                    'days_back': {
                        'type': 'integer',
                        'description': '回溯天数',
                        'default': 365,
                    },
                    'limit': {'type': 'integer', 'default': 20},
                },
                'required': ['pet_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'save_pet_event',
            'description': '将本次对话产出的事件（如 VLM 分析结果、用户报告的症状等）持久化到时间线。'
                           '一般在给出最终建议前调用一次，保存关键信息。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'pet_id': {'type': 'integer'},
                    'event_type': {
                        'type': 'string',
                        'description': 'bcs / symptom / vaccine / weight / emotion / pain_fgs / feeding / grooming / '
                                       'milestone（训练或社会化里程碑，如"学会握手"/"第一次主动凑过来"）/ '
                                       'note（其他有趣观察或备忘，如"换新粮吃得很香"）。'
                                       '"photo" 已弃用——有趣事件请用 milestone 或 note。',
                    },
                    'payload': {
                        'type': 'object',
                        'description': '结构化数据，如 {"bcs_score": 7, "rationale": "..."}',
                    },
                    'note': {'type': 'string', 'description': '简短说明'},
                },
                'required': ['pet_id', 'event_type'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'reanalyze_image',
            'description': '重新分析当前会话已有的图片。两种合理使用场景：'
                           '(A) **换 task 重看**：主人说"看看情绪/做 BCS/疼痛评估"等切换分析维度 → 调 reanalyze(task=新task)，**可不填 focus**；'
                           '(B) **同 task 看细节**：主人说"再看一下耳朵/瞳孔"等具体部位 → 调 reanalyze(task=原task, focus="耳朵")。'
                           '**前提**：本会话必须已有图片（system context 有"图片 VLM 分析结果"或"历史 VLM 分析"块）。'
                           '**避免**：同 task + 空 focus（已有分析，重复调没意义，工程层会拒绝）。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'task': {
                        'type': 'string',
                        'enum': ['symptom', 'emotion', 'bcs', 'pain_fgs'],
                        'description': '换什么 task 重新看',
                    },
                    'focus': {
                        'type': 'string',
                        'description': '可选：聚焦的具体部位/问题（"耳朵朝向"、"瞳孔大小"）。换 task 重看时可省略。',
                    },
                },
                'required': ['task'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'find_nearby_clinic',
            'description': '查找用户当前位置附近的宠物医院。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'location': {
                        'type': 'string',
                        'description': '地址或地区描述，如"北京海淀中关村"、"上海徐汇"',
                    },
                    'emergency': {
                        'type': 'boolean',
                        'description': '是否找 24 小时急诊医院',
                        'default': False,
                    },
                    'radius_meters': {'type': 'integer', 'default': 3000},
                },
                'required': ['location'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'schedule_reminder',
            'description': '为宠物创建一条计划提醒（疫苗/驱虫/洗澡/服药/体检），到时间会发邮件给主人。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'pet_id': {'type': 'integer', 'description': '宠物 ID'},
                    'reminder_type': {
                        'type': 'string',
                        'enum': ['vaccine', 'deworm', 'bath', 'medication', 'checkup', 'other'],
                        'description': 'vaccine 疫苗 / deworm 驱虫 / bath 洗澡 / medication 服药 / checkup 体检 / other 其他',
                    },
                    'scheduled_at_local': {
                        'type': 'string',
                        'description': '本地时间（Asia/Shanghai），ISO 格式 "YYYY-MM-DDTHH:MM:SS" 或 "YYYY-MM-DD HH:MM"。不要带时区后缀。例如 "2026-05-20T09:00:00"。',
                    },
                    'message': {
                        'type': 'string',
                        'description': '提醒备注，简短一句话，如"猫三联第二针"、"拜耳驱虫片"',
                    },
                    'repeat_rule': {
                        'type': 'string',
                        'description': '重复规则（可选）：monthly / yearly / every:90d。MVP 仅显示标签，到期触发后会给主人"再加一条"按钮。',
                    },
                },
                'required': ['pet_id', 'reminder_type', 'scheduled_at_local', 'message'],
            },
        },
    },
    # send_alert_email 已从 agent tools 移除：主人就在 chat 前看，不需要再发邮件给自己。
    # _send_alert_email 实现保留在下方未启用。
]


# ============ Tool implementations ============

def _retrieve_vet_knowledge(args: dict, ctx: dict) -> dict:
    retriever = get_retriever()
    where: dict[str, Any] = {}
    if args.get('species') == 'cat':
        where['species_cat'] = True
    elif args.get('species') == 'dog':
        where['species_dog'] = True
    if args.get('emergency_only'):
        where['emergency'] = True

    results = retriever.search(
        query=args['query'],
        top_k=args.get('top_k', 5),
        where=where or None,
        rerank=True,
    )
    # 给 LLM 简洁视图（不传全部 body 避免 token 爆）
    return {
        'count': len(results),
        'results': [
            {
                'title': r['title'],
                'body': r['body'][:500],  # 截断
                'meta': {
                    'severity': r['meta'].get('severity'),
                    'emergency': r['meta'].get('emergency'),
                    'source': r['meta'].get('source'),
                },
                'score': round(r['score'], 3),
            }
            for r in results
        ],
    }


def _query_pet_history(args: dict, ctx: dict) -> dict:
    session: Session = ctx['session']
    pet_id = args['pet_id']
    days_back = args.get('days_back', 365)
    cutoff = datetime.now() - timedelta(days=days_back)

    stmt = (
        select(PetEvent)
        .where(PetEvent.pet_id == pet_id)
        .where(PetEvent.happened_at >= cutoff)
    )
    if args.get('event_type'):
        stmt = stmt.where(PetEvent.event_type == args['event_type'])
    stmt = stmt.order_by(PetEvent.happened_at.desc()).limit(args.get('limit', 20))

    events = session.exec(stmt).all()
    out = []
    for e in events:
        try:
            payload = json.loads(e.payload_json) if e.payload_json else {}
        except json.JSONDecodeError:
            payload = {}
        out.append({
            'id': e.id,
            'event_type': e.event_type,
            'payload': payload,
            'note': e.note,
            'happened_at': e.happened_at.isoformat(),
        })
    return {'count': len(out), 'events': out}


def _save_pet_event(args: dict, ctx: dict) -> dict:
    session: Session = ctx['session']
    pet_id = args.get('pet_id')
    event_type = args.get('event_type')
    if pet_id is None or event_type is None:
        return {'ok': False, 'error': 'missing pet_id or event_type'}

    # payload 容错：LLM 偶尔会传非 dict（字符串/None）
    raw_payload = args.get('payload')
    if isinstance(raw_payload, dict):
        payload = raw_payload
    elif isinstance(raw_payload, str):
        try:
            parsed = json.loads(raw_payload)
            payload = parsed if isinstance(parsed, dict) else {'raw': raw_payload}
        except json.JSONDecodeError:
            payload = {'raw': raw_payload}
    else:
        payload = {}

    # note 容错：偶尔 LLM 传 dict 而不是 string
    raw_note = args.get('note')
    if isinstance(raw_note, str):
        note = raw_note
    elif raw_note is None:
        note = None
    else:
        note = json.dumps(raw_note, ensure_ascii=False)

    pet = session.get(Pet, pet_id)
    if not pet or pet.deleted_at:
        return {'ok': False, 'error': f'pet {pet_id} not found'}

    # weight event 特殊处理：enrich payload + 同步更新 pet.weight_kg（单一来源）
    weight_synced = False
    if event_type == 'weight':
        new_weight = payload.get('weight_kg')
        # 工程兜底：LLM 偶尔把数字塞 note 不填 payload → 从 note 提取
        # 匹配 "X kg" / "X 公斤" / "X 千克"（不识别"斤"，避免单位歧义）
        if not isinstance(new_weight, (int, float)) and note:
            m = re.search(r'(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)', note, re.IGNORECASE)
            if m:
                try:
                    new_weight = float(m.group(1))
                    payload = {**payload, 'weight_kg': new_weight}
                except ValueError:
                    pass
        if isinstance(new_weight, (int, float)):
            old_weight = pet.weight_kg
            payload = {
                **payload,
                'previous': old_weight,
                'delta': round(new_weight - old_weight, 2) if old_weight is not None else None,
                'source': 'llm',
            }
            if old_weight != new_weight:
                pet.weight_kg = new_weight
                pet.updated_at = datetime.now()
                session.add(pet)
                weight_synced = True

    e = PetEvent(
        pet_id=pet_id,
        event_type=event_type,
        payload_json=json.dumps(payload, ensure_ascii=False),
        note=note,  # 已 sanitize 过
        happened_at=datetime.now(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return {
        'ok': True,
        'event_id': e.id,
        'happened_at': e.happened_at.isoformat(),
        'weight_synced': weight_synced,
    }


def _reanalyze_image(args: dict, ctx: dict) -> dict:
    image_path = ctx.get('image_path')
    if not image_path:
        return {'ok': False, 'error': 'no image in current session'}

    # P6.3 智能兜底：同 task 重复调 + 空 focus → 拒绝（避免 LLM 滥用 reanalyze 当 motivation 占位）
    # 换 task 重看是合理的（如 bcs → emotion），允许空 focus
    focus = (args.get('focus') or '').strip()
    last_vlm_task = ctx.get('last_vlm_task')
    if last_vlm_task and args.get('task') == last_vlm_task and not focus:
        return {
            'ok': False,
            'skipped': True,
            'reason': f'同 task "{last_vlm_task}" 已有 VLM 分析，无 focus 不需重看。'
                      f'若要重看细节请加 focus 参数（如"耳朵朝向"）；'
                      f'若只是回答主人问题，直接基于上方"图片 VLM 分析结果"或"历史 VLM 分析"块回答即可。',
        }

    # 延迟 import 避免循环
    from app.agent.vlm import analyze

    pet_id = ctx['pet_id']
    session: Session = ctx['session']
    pet = session.get(Pet, pet_id)
    species = pet.species if pet else None

    extra = args.get('focus') or ''
    try:
        result = analyze(
            image_path=image_path,
            task=args['task'],
            species={'cat': '猫', 'dog': '狗'}.get(species, species),
            extra=extra,
        )
        return {'ok': True, 'task': args['task'], 'analysis': result}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _find_nearby_clinic(args: dict, ctx: dict) -> dict:
    """高德 Web 服务 API：先地理编码 → 周边搜索 type='宠物医院'。"""
    amap_key = os.getenv('AMAP_KEY', '')
    if not amap_key:
        return {'ok': False, 'error': 'AMAP_KEY not configured'}

    location_text = args['location']
    emergency = args.get('emergency', False)
    radius = args.get('radius_meters', 3000)

    try:
        # 1. 地理编码：地址 → 经纬度
        geo_resp = requests.get(
            'https://restapi.amap.com/v3/geocode/geo',
            params={'key': amap_key, 'address': location_text},
            timeout=10,
        )
        geo = geo_resp.json()
        if geo.get('status') != '1' or not geo.get('geocodes'):
            return {'ok': False, 'error': f'cannot geocode: {location_text}'}
        location = geo['geocodes'][0]['location']  # 'lng,lat'

        # 2. 周边 POI 搜索
        # 不限制 types（高德的 090000 医疗保健不一定覆盖宠物医院，且 keywords+types 双约束太严）
        # emergency 时优先返回名字含"24"或"急诊"的，后处理过滤
        keywords = '宠物医院'
        poi_resp = requests.get(
            'https://restapi.amap.com/v3/place/around',
            params={
                'key': amap_key,
                'location': location,
                'keywords': keywords,
                'radius': radius,
                'offset': 20,  # 拿多一些，便于 emergency 后过滤
                'extensions': 'base',
            },
            timeout=10,
        )
        data = poi_resp.json()
        if data.get('status') != '1':
            return {'ok': False, 'error': f'POI search failed: {data.get("info")}'}

        all_pois = data.get('pois', [])

        # emergency 时优先 24h/急诊关键词
        if emergency:
            priority = [p for p in all_pois if '24' in p.get('name', '') or '急诊' in p.get('name', '')]
            others = [p for p in all_pois if p not in priority]
            ordered = priority + others
        else:
            ordered = all_pois

        clinics = []
        for poi in ordered[:5]:
            clinics.append({
                'name': poi.get('name'),
                'address': poi.get('address') or (poi.get('pname', '') + poi.get('cityname', '') + poi.get('adname', '')),
                'distance_m': int(poi.get('distance', 0)) if poi.get('distance') else None,
                'tel': poi.get('tel') or '未提供',
                'is_emergency_candidate': '24' in poi.get('name', '') or '急诊' in poi.get('name', ''),
            })
        return {
            'ok': True,
            'origin': location_text,
            'origin_coord': location,
            'count': len(clinics),
            'total_pois_found': len(all_pois),
            'clinics': clinics,
        }
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _schedule_reminder(args: dict, ctx: dict) -> dict:
    """LLM 入口：创建一条计划提醒。本地时间 → UTC 入库 + 排进 scheduler。"""
    from zoneinfo import ZoneInfo
    # 延迟 import 避免循环（services.scheduler imports tools 间接可能）
    from app.services.email import _REMINDER_TYPE_LABEL  # type: ignore
    from app.services.scheduler import add_reminder_job
    from datetime import timezone

    LOCAL_TZ = ZoneInfo('Asia/Shanghai')
    ALLOWED = ('vaccine', 'deworm', 'bath', 'medication', 'checkup', 'other')

    session: Session = ctx['session']
    pet_id = args.get('pet_id')
    reminder_type = args.get('reminder_type')
    scheduled_local = (args.get('scheduled_at_local') or '').strip()
    message = (args.get('message') or '').strip()
    repeat_rule = args.get('repeat_rule') or None

    if not pet_id or not reminder_type or not scheduled_local:
        return {'ok': False, 'error': 'missing required args (pet_id, reminder_type, scheduled_at_local)'}
    if reminder_type not in ALLOWED:
        return {'ok': False, 'error': f'invalid reminder_type "{reminder_type}", must be one of {ALLOWED}'}

    # 解析本地时间——容错多种格式
    candidates = [
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%dT%H:%M',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d %H:%M',
    ]
    local_dt = None
    cleaned = scheduled_local.replace('Z', '').split('.')[0]  # 去掉可能误加的 Z 或微秒
    for fmt in candidates:
        try:
            local_dt = datetime.strptime(cleaned, fmt)
            break
        except ValueError:
            continue
    if local_dt is None:
        return {'ok': False, 'error': f'cannot parse scheduled_at_local "{scheduled_local}"，请用 YYYY-MM-DDTHH:MM:SS 本地时间格式'}

    # 本地 → UTC naive
    aware_local = local_dt.replace(tzinfo=LOCAL_TZ)
    utc_naive = aware_local.astimezone(timezone.utc).replace(tzinfo=None)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    if utc_naive <= now_utc:
        return {'ok': False, 'error': f'scheduled_at_local "{scheduled_local}" 已过去（本地当前 {datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H:%M")}），请选未来时间'}

    pet = session.get(Pet, pet_id)
    if not pet or pet.deleted_at:
        return {'ok': False, 'error': f'pet {pet_id} not found'}

    label = _REMINDER_TYPE_LABEL.get(reminder_type, '📝 提醒')
    r = Reminder(
        pet_id=pet_id,
        reminder_type=reminder_type,
        scheduled_at=utc_naive,
        message=message,
        repeat_rule=repeat_rule,
        preview_subject=f'[PetPal] {pet.name} · {label}提醒',
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    add_reminder_job(r.id, utc_naive)
    return {
        'ok': True,
        'reminder_id': r.id,
        'pet_name': pet.name,
        'reminder_type': reminder_type,
        'scheduled_at_local': local_dt.strftime('%Y-%m-%d %H:%M'),
        'repeat_rule': repeat_rule,
    }


def _send_alert_email(args: dict, ctx: dict) -> dict:
    """P4 阶段仅日志，不真发邮件（P6 真接 SMTP）。"""
    print(
        f'\n  [📧 SIMULATED EMAIL]\n'
        f'  severity: {args["severity"]}\n'
        f'  subject:  {args["subject"]}\n'
        f'  body:     {args["body"][:200]}...\n'
    )
    return {
        'sent': False,
        'simulated': True,
        'message': 'P4 stub - email will be implemented in P6',
    }


# ============ Dispatcher ============

TOOL_DISPATCH = {
    'retrieve_vet_knowledge': _retrieve_vet_knowledge,
    'query_pet_history': _query_pet_history,
    'save_pet_event': _save_pet_event,
    'reanalyze_image': _reanalyze_image,
    'find_nearby_clinic': _find_nearby_clinic,
    'schedule_reminder': _schedule_reminder,  # P6.2
    # _send_alert_email 实现保留但未注册（P6 改用 schedule_reminder + scheduler 路径）
}
