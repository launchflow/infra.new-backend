from datetime import datetime
import hashlib
from platform import machine
import re
from typing import Dict, Literal, Tuple

from google.cloud import compute
from sqlmodel import Session, and_, func, select

from app.db.models import Price, Product
from app.db.dependencies import engine


machine_type_description_lookups: Dict[str, Dict[str, str]] = {
    "c2": {
        "cpu": "Compute optimized Core",
        "memory": "Compute optimized Ram",
    },
    "e2": {
        "cpu": "E2 Instance Core",
        "memory": "E2 Instance Ram",
    },
    "f1": {
        "total": "Micro Instance with burstable CPU",
    },
    "g1": {
        "total": "Small Instance with 1 VCPU",
    },
    "m1": {
        "cpu": "Memory-optimized Instance Core",
        "memory": "Memory-optimized (Instance )?Ram",
    },
    "n1": {
        "cpu": "N1 Predefined Instance Core",
        "memory": "N1 Predefined Instance Ram",
    },
    "n2": {
        "cpu": "N2 Instance Core",
        "memory": "N2 Instance Ram",
    },
    "n2d": {
        "cpu": "N2D AMD Instance Core",
        "memory": "N2D AMD Instance Ram",
    },
    "a2": {
        "cpu": "A2 Instance Core",
        "memory": "A2 Instance Ram",
    },
}

machine_type_overrides: Dict[str, Dict[str, float]] = {
    "e2-micro": {"cpu": 0.25},
    "e2-small": {"cpu": 0.5},
    "e2-medium": {"cpu": 1},
}


async def scrape():
    with Session(engine) as db:
        mt_client = compute.MachineTypesClient()
        region_client = compute.RegionsClient()

        regions = region_client.list(project="infra-new-dev")
        for region in regions:
            region_zones = [z.split("/")[-1] for z in region.zones]

            machine_types = mt_client.list(
                project="infra-new-dev", zone=region_zones[0]
            )

            for machine_type in machine_types:
                sku = f"gcp-machine-type-generated-{machine_type.name}"
                hash_str = f"gcp-{region}-{sku}"
                product_hash = hashlib.sha256(hash_str.encode()).hexdigest()
                db_product = Product(
                    product_hash=product_hash,
                    sku=sku,
                    vendor_name="gcp",
                    region=region.name,
                    service="Compute Engine",
                    product_family="Compute Instance",
                    attributes={
                        "machine_type": machine_type.name,
                    },
                )
                db.add(db_product)

                on_demand_price = machineTypeToPrice(
                    db_product,
                    machine_type,
                    "on_demand",
                    db,
                )
                if on_demand_price is not None:
                    db.add(on_demand_price)
                preemptible_price = machineTypeToPrice(
                    db_product,
                    machine_type,
                    "preemptible",
                    db,
                )
                if preemptible_price is not None:
                    db.add(preemptible_price)
        db.commit()


def machineTypeToPrice(
    product: Product,
    machine_type: compute.MachineType,
    purchase_option: Literal["on_demand", "preemptible"],
    session: Session,
):
    prefix = machine_type.name.split("-")[0]

    if prefix not in machine_type_description_lookups:
        print(f"Machine type prefix {prefix} not found in description lookups")
        return

    description_lookup = machine_type_description_lookups[prefix]
    result = None
    if "total" in description_lookup:
        result = calculate_amount_from_total(
            product, machine_type, purchase_option, description_lookup["total"], session
        )
    else:
        result = calculate_amount_from_cpu_and_mem(
            product, machine_type, purchase_option, session, description_lookup
        )
    if result is None:
        print(
            f"Could not compute price for machine type {machine_type.name} in {product.region}"
        )
        return None
    amount, effective_date_start = result
    unit = "Hours"

    price_hash_str = f"{product.product_hash}-{purchase_option}-{unit}"

    return Price(
        price_hash=price_hash_str,
        purchase_option=purchase_option,
        unit=unit,
        usd=str(amount),
        effective_start_date=effective_date_start,
        product_hash=product.product_hash,
    )


def calculate_amount_from_total(
    product: Product,
    machine_type: compute.MachineType,
    purchase_option: Literal["on_demand", "preemptible"],
    description: str,
    session: Session,
) -> Tuple[float, str] | None:
    desc_regex = re.compile(f"^{description}")
    if purchase_option == "preemptible":
        desc_regex = re.compile(f"^Spot Preemptible {description}")

    matched_product = find_compute_products(product.region or "", desc_regex, session)

    if not matched_product:
        print(
            f"Could not find product for machine type {machine_type.name} and purchase option {purchase_option}"
        )
        return None

    matched_price = next(
        (p for p in matched_product.prices if p.end_usage_amount is None),
        matched_product.prices[0],
    )
    amount = float(matched_price.usd or 0)
    effective_date_start = matched_price.effective_start_date or str(datetime.now())

    return amount, effective_date_start


def calculate_amount_from_cpu_and_mem(
    product: Product,
    machine_type: compute.MachineType,
    purchase_option: str,
    session: Session,
    description_lookup: Dict[str, str],
) -> Tuple[float, str] | None:
    cpu_desc = description_lookup["cpu"]
    mem_desc = description_lookup["memory"]

    cpu_desc_regex = re.compile(f"^{cpu_desc}")
    mem_desc_regex = re.compile(f"^{mem_desc}")
    if purchase_option == "preemptible":
        cpu_desc_regex = re.compile(f"^Spot Preemptible {cpu_desc}")
        mem_desc_regex = re.compile(f"^Spot Preemptible {mem_desc}")

    cpu_product = find_compute_products(product.region or "", cpu_desc_regex, session)
    mem_product = find_compute_products(product.region or "", mem_desc_regex, session)

    if not cpu_product:
        print(
            f"Could not find CPU product for machine type {machine_type.name} and purchase option {purchase_option}"
        )
        return None
    if not mem_product:
        print(
            f"Could not find memory product for machine type {machine_type.name} and purchase option {purchase_option}"
        )
        return None

    machine_type.guest_cpus

    overrides = machine_type_overrides.get(machine_type.name, {})
    cpu = float(overrides.get("cpu", machine_type.guest_cpus))
    mem = float(overrides.get("memory", machine_type.memory_mb)) / 1024

    cpu_price = next(
        (p for p in cpu_product.prices if p.end_usage_amount is None),
        cpu_product.prices[0],
    )
    mem_price = next(
        (p for p in mem_product.prices if p.end_usage_amount is None),
        mem_product.prices[0],
    )

    amount = cpu * float(cpu_price.usd or 0) + mem * float(mem_price.usd or 0)

    cpu_effective_date_start = cpu_price.effective_date_end
    mem_effective_date_start = mem_price.effective_date_end
    effective_date_start = (
        min(cpu_effective_date_start, mem_effective_date_start)
        if cpu_effective_date_start and mem_effective_date_start
        else str(datetime.now())
    )

    return amount, effective_date_start


def find_compute_products(
    region: str, description: re.Pattern, db: Session
) -> Product | None:
    stmt = select(Product).where(
        and_(
            Product.vendor_name == "gcp",
            Product.service == "Compute Engine",
            Product.product_family == "Compute",
            Product.region == region,
            func.json_extract_path_text(Product.attributes, "description").op("~")(
                description.pattern
            ),
        )
    )

    return db.exec(stmt).first()
