"""Pets CRUD + 头像上传 API。软删通过 deleted_at 字段。"""
from __future__ import annotations

import io
import json
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from PIL import Image
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.auth.deps import ensure_pet_owned_by, get_current_user
from app.db.database import get_session
from app.db.models import Pet, PetEvent, User

router = APIRouter(prefix='/api/pets', tags=['pets'])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / 'data' / 'uploads' / 'pets'


# === IO Schemas ===

class PetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    species: str  # 'cat' | 'dog'
    breed: Optional[str] = None
    birthday: Optional[date] = None
    gender: Optional[str] = None  # 'male' / 'female' / 'unknown'
    neutered: Optional[bool] = None
    weight_kg: Optional[float] = None


class PetUpdate(BaseModel):
    """所有字段可选，只更新传入的。"""
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    breed: Optional[str] = None
    birthday: Optional[date] = None
    gender: Optional[str] = None
    neutered: Optional[bool] = None
    weight_kg: Optional[float] = None
    photo_url: Optional[str] = None


def _validate_species(species: str) -> None:
    if species not in ('cat', 'dog'):
        raise HTTPException(400, "species must be 'cat' or 'dog'")


def _validate_gender(gender: Optional[str]) -> None:
    if gender is not None and gender not in ('male', 'female', 'unknown'):
        raise HTTPException(400, "gender must be 'male'/'female'/'unknown' or null")


# === Endpoints ===

@router.get('', response_model=list[Pet])
async def list_pets(
    include_deleted: bool = Query(False),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(Pet).where(Pet.user_id == user.id)
    if not include_deleted:
        stmt = stmt.where(Pet.deleted_at.is_(None))
    stmt = stmt.order_by(Pet.created_at.desc())
    return session.exec(stmt).all()


@router.post('', response_model=Pet)
async def create_pet(
    data: PetCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _validate_species(data.species)
    _validate_gender(data.gender)
    pet = Pet(**data.model_dump(), user_id=user.id)
    session.add(pet)
    session.commit()
    session.refresh(pet)

    # 初始体重 → 写一条 weight event 作为时序起点
    if pet.weight_kg is not None:
        ev = PetEvent(
            pet_id=pet.id,
            event_type='weight',
            payload_json=json.dumps({
                'weight_kg': pet.weight_kg,
                'previous': None,
                'delta': None,
                'source': 'create_pet',
            }, ensure_ascii=False),
            note='[初始体重]',
        )
        session.add(ev)
        session.commit()
        session.refresh(pet)  # commit 后 expire_on_commit 会把 pet attrs 清空，要重新加载
    return pet


@router.get('/{pet_id}', response_model=Pet)
async def get_pet(
    pet_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return ensure_pet_owned_by(pet_id, user, session)


@router.patch('/{pet_id}', response_model=Pet)
async def update_pet(
    pet_id: int,
    data: PetUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    pet = ensure_pet_owned_by(pet_id, user, session)
    _validate_gender(data.gender)

    payload = data.model_dump(exclude_unset=True)

    # 检测 weight_kg 变化（None / 相等都不算变化）
    old_weight = pet.weight_kg
    new_weight = payload.get('weight_kg')
    weight_changed = (
        'weight_kg' in payload
        and new_weight is not None
        and new_weight != old_weight
    )

    for k, v in payload.items():
        setattr(pet, k, v)
    pet.updated_at = datetime.now()

    session.add(pet)
    session.commit()
    session.refresh(pet)

    if weight_changed:
        delta = round(new_weight - old_weight, 2) if old_weight is not None else None
        ev = PetEvent(
            pet_id=pet.id,
            event_type='weight',
            payload_json=json.dumps({
                'weight_kg': new_weight,
                'previous': old_weight,
                'delta': delta,
                'source': 'update_pet',
            }, ensure_ascii=False),
        )
        session.add(ev)
        session.commit()
        session.refresh(pet)  # 同上
    return pet


@router.delete('/{pet_id}')
async def soft_delete_pet(
    pet_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    pet = ensure_pet_owned_by(pet_id, user, session)
    pet.deleted_at = datetime.now()
    pet.updated_at = pet.deleted_at
    session.add(pet)
    session.commit()
    return {'ok': True, 'pet_id': pet_id, 'deleted_at': pet.deleted_at.isoformat()}


@router.post('/{pet_id}/restore', response_model=Pet)
async def restore_pet(
    pet_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """撤销软删除——MVP 阶段没 UI，但接口留着以防误删。"""
    pet = session.get(Pet, pet_id)
    if not pet or pet.user_id != user.id:
        raise HTTPException(404, 'pet not found')
    if not pet.deleted_at:
        raise HTTPException(400, 'pet is not deleted')
    pet.deleted_at = None
    pet.updated_at = datetime.now()
    session.add(pet)
    session.commit()
    session.refresh(pet)
    return pet


@router.post('/{pet_id}/avatar', response_model=Pet)
async def upload_avatar(
    pet_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    pet = ensure_pet_owned_by(pet_id, user, session)

    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(400, 'file must be an image')

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, 'image too large (>10MB)')

    try:
        img = Image.open(io.BytesIO(raw))
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.thumbnail((512, 512), Image.Resampling.LANCZOS)
    except Exception as e:
        raise HTTPException(400, f'invalid image: {e}')

    pet_dir = UPLOAD_DIR / str(pet_id)
    pet_dir.mkdir(parents=True, exist_ok=True)

    # 时间戳文件名 → 浏览器不会缓存旧头像
    fname = f'avatar_{int(datetime.now().timestamp())}.jpg'
    save_path = pet_dir / fname
    img.save(save_path, format='JPEG', quality=85, optimize=True)

    pet.photo_url = f'/static/pets/{pet_id}/{fname}'
    pet.updated_at = datetime.now()
    session.add(pet)
    session.commit()
    session.refresh(pet)
    return pet
