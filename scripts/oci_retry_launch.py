"""
Oracle Cloud: 循环重试创建 Always Free 的 ARM 实例（VM.Standard.A1.Flex）。

大阪免费池经常 "Out of host capacity"，这个脚本每隔 INTERVAL 秒发一次创建请求，
成功即停，并打印公网 IP。零 token 消耗，可以挂一整夜。

前置条件（一次性）：
  1. pip install oci
  2. 控制台右上角头像 -> My profile -> API keys -> Add API key
     -> Generate API key pair -> 下载私钥 -> Add
     -> 把弹出的 config 片段存到  C:\\Users\\90968\\.oci\\config
        并把 key_file= 改成私钥的实际路径
  3. 用 Oracle 生成的 SSH 私钥（oracle.key）推导公钥，脚本会自动调 ssh-keygen 做这件事

用法：
  python scripts/oci_retry_launch.py --ssh-key C:\\Users\\90968\\.ssh\\oracle.key
可选：
  --ocpus 2 --memory 8 --name petpal --vcn petpal-vcn --interval 60
"""

import argparse
import subprocess
import sys
import time
from datetime import datetime

try:
    import oci
except ImportError:
    sys.exit("先安装 SDK：pip install oci")


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def derive_public_key(private_key_path: str) -> str:
    """ssh-keygen -y 从私钥推导公钥（Windows 10/11 自带 OpenSSH）。"""
    try:
        out = subprocess.run(
            ["ssh-keygen", "-y", "-f", private_key_path],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError:
        sys.exit("找不到 ssh-keygen，请确认 Windows 的 OpenSSH 客户端已安装")
    except subprocess.CalledProcessError as e:
        sys.exit(f"ssh-keygen 推导公钥失败：{e.stderr.strip()}")
    return out.stdout.strip()


def pick_subnet(vn_client, compartment_id: str, vcn_name: str):
    vcns = oci.pagination.list_call_get_all_results(
        vn_client.list_vcns, compartment_id, display_name=vcn_name
    ).data
    if not vcns:
        sys.exit(f"没找到名为 {vcn_name} 的 VCN")
    subnets = oci.pagination.list_call_get_all_results(
        vn_client.list_subnets, compartment_id, vcn_id=vcns[0].id
    ).data
    public = [s for s in subnets if not s.prohibit_public_ip_on_vnic]
    if not public:
        sys.exit(f"VCN {vcn_name} 下没有公网子网")
    return public[0]


def pick_image(compute_client, compartment_id: str, shape: str):
    images = oci.pagination.list_call_get_all_results(
        compute_client.list_images,
        compartment_id,
        operating_system="Canonical Ubuntu",
        operating_system_version="22.04",
        shape=shape,
        sort_by="TIMECREATED",
        sort_order="DESC",
    ).data
    # 排除 Minimal 版本，取最新的标准 aarch64 镜像
    images = [i for i in images if "Minimal" not in i.display_name]
    if not images:
        sys.exit("没找到 Ubuntu 22.04 的 ARM 镜像")
    return images[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssh-key", required=True, help="Oracle 生成的 SSH 私钥路径（oracle.key）")
    ap.add_argument("--name", default="petpal")
    ap.add_argument("--vcn", default="petpal-vcn")
    ap.add_argument("--ocpus", type=float, default=2)
    ap.add_argument("--memory", type=float, default=8, help="GB")
    ap.add_argument("--interval", type=int, default=60, help="重试间隔秒数")
    ap.add_argument("--profile", default="DEFAULT", help="~/.oci/config 里的 profile 名")
    args = ap.parse_args()

    shape = "VM.Standard.A1.Flex"
    config = oci.config.from_file(profile_name=args.profile)
    oci.config.validate_config(config)
    compartment_id = config["tenancy"]  # root compartment 就是 tenancy OCID

    identity = oci.identity.IdentityClient(config)
    compute = oci.core.ComputeClient(config)
    vn = oci.core.VirtualNetworkClient(config)

    ad = identity.list_availability_domains(compartment_id).data[0].name
    subnet = pick_subnet(vn, compartment_id, args.vcn)
    image = pick_image(compute, compartment_id, shape)
    ssh_pub = derive_public_key(args.ssh_key)

    log(f"可用域: {ad}")
    log(f"子网: {subnet.display_name}")
    log(f"镜像: {image.display_name}")
    log(f"规格: {shape} {args.ocpus} OCPU / {args.memory} GB")
    log(f"每 {args.interval}s 重试一次，Ctrl+C 停止")

    details = oci.core.models.LaunchInstanceDetails(
        availability_domain=ad,
        compartment_id=compartment_id,
        display_name=args.name,
        shape=shape,
        shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=args.ocpus, memory_in_gbs=args.memory
        ),
        source_details=oci.core.models.InstanceSourceViaImageDetails(
            image_id=image.id, boot_volume_size_in_gbs=50
        ),
        create_vnic_details=oci.core.models.CreateVnicDetails(
            subnet_id=subnet.id, assign_public_ip=True
        ),
        metadata={"ssh_authorized_keys": ssh_pub},
    )

    attempt = 0
    while True:
        attempt += 1
        try:
            inst = compute.launch_instance(details).data
            log(f"第 {attempt} 次：创建成功！实例 {inst.id}")
            break
        except oci.exceptions.ServiceError as e:
            msg = (e.message or "").lower()
            if "out of capacity" in msg or "out of host capacity" in msg:
                log(f"第 {attempt} 次：没容量，{args.interval}s 后再试")
                time.sleep(args.interval)
            elif e.status == 429:
                log(f"第 {attempt} 次：被限流，等 5 分钟")
                time.sleep(300)
            else:
                log(f"第 {attempt} 次：其他错误 {e.status} {e.code}: {e.message}")
                sys.exit(1)
        except KeyboardInterrupt:
            log("手动停止")
            sys.exit(0)

    log("等待实例进入 RUNNING ...")
    oci.wait_until(compute, compute.get_instance(inst.id), "lifecycle_state", "RUNNING",
                   max_wait_seconds=600)

    vnics = compute.list_vnic_attachments(compartment_id, instance_id=inst.id).data
    vnic = vn.get_vnic(vnics[0].vnic_id).data
    log(f"实例已运行，公网 IP: {vnic.public_ip}")
    log(f"连接命令: ssh -i {args.ssh_key} ubuntu@{vnic.public_ip}")


if __name__ == "__main__":
    main()
