import asyncio
from dataclasses import dataclass
import dataclasses
import json
import aiofiles
from typing import List, Dict, Any, Tuple
from glob import glob
import os


from google.cloud import billing
from google.api_core.exceptions import ResourceExhausted
import hashlib

from sqlmodel import Session

from app.db.models import Price, Product as ProductModel
from app.db.dependencies import engine


@dataclass
class Service:
    service_id: str
    display_name: str


@dataclass
class Product:
    sku_id: str
    service_regions: List[str]
    service_display_name: str
    product_family: str
    attributes: Dict[str, str]
    prices: List[Dict[str, Any]]


class PricingJson(Dict):
    pricingExpression: Dict[str, Any]
    effectiveTime: str


class TieredRateJson(Dict):
    startUsageAmount: float
    unitPrice: Dict[str, Any]


async def scrape():
    # await download_all()
    await load_all()


async def download_all():
    client = billing.CloudCatalogAsyncClient()

    print("Downloading all services")
    services = await get_services(client)
    for service in services:
        try:
            await download_service(service, client)
        except Exception as e:
            print(f"Skipping service {service} due to error {e}")
            print(f"Error details: {str(e)}")


async def get_services(client: billing.CloudCatalogAsyncClient) -> List[Service]:
    gcp_services = await client.list_services()
    services = []
    async for service in gcp_services:
        services.append(
            Service(
                service_id=service.service_id,
                display_name=service.display_name,
            )
        )
    return services


async def download_service(service: Service, client: billing.CloudCatalogAsyncClient):
    print(f"Downloading {service.display_name}")
    while True:
        try:
            skus = await client.list_skus(parent=f"services/{service.service_id}")
            break
        except ResourceExhausted:
            print("Too many requests, sleeping for 30s and retrying")
            await asyncio.sleep(30)

    filename = f"data/gcp-{service.service_id}.json"
    json_skus = []
    async for sku in skus:
        prices = []
        for price in sku.pricing_info:
            for i, tier in enumerate(price.pricing_expression.tiered_rates):
                next_tier = (
                    price.pricing_expression.tiered_rates[i + 1]
                    if i + 1 < len(price.pricing_expression.tiered_rates)
                    else None
                )
                prices.append(
                    {
                        "purchase_option": sku.category.usage_type,
                        "unit": price.pricing_expression.usage_unit_description,
                        "USD": f"{tier.unit_price.units}.{str(tier.unit_price.nanos).zfill(9)}",
                        "effective_date_start": str(price.effective_time),
                        "start_usage_amount": str(tier.start_usage_amount),
                        "end_usage_amount": str(next_tier.start_usage_amount)
                        if next_tier
                        else None,
                    }
                )
        product = Product(
            sku_id=sku.sku_id,
            service_regions=list(sku.service_regions),
            service_display_name=sku.category.service_display_name,
            product_family=sku.category.resource_family,
            attributes={
                "description": sku.description,
                "resource_group": sku.category.resource_group,
            },
            prices=prices,
        )
        json_skus.append(dataclasses.asdict(product))
    async with aiofiles.open(filename, mode="w") as f:
        await f.write(json.dumps({"skus": json_skus}))


async def load_all():
    for filename in glob("data/gcp-*.json"):
        print(f"Processing file: {filename}")
        try:
            await process_file(filename)
            os.remove(filename)
        except Exception as e:
            print(f"Skipping file {filename} due to error {e}")
            print(f"Error details: {str(e)}")


async def process_file(filename: str):
    async with aiofiles.open(filename, mode="r") as f:
        content = await f.read()
        json_data = json.loads(content)

    with Session(engine) as session:
        for product_json in json_data["skus"]:
            for region in product_json["service_regions"]:
                # sku_id = product_json["sku_id"]
                # hash_str = f"gcp-{region}-{sku_id}"
                # product_hash = hashlib.sha256(hash_str.encode()).hexdigest()
                # stmt = select(ProductModel).where(
                #     ProductModel.product_hash == product_hash
                # )
                # product = session.exec(stmt).first()
                # if product is not None:
                #     print(f"Skipping since it already exists {product_hash}")
                #     return
                product, prices = parse_product(product_json, region)
                session.merge(product)
                for price in prices:
                    session.merge(price)

        session.commit()


price_hash_keys = [
    "purchase_option",
    "unit",
    "start_usage_amount",
    "end_usage_amount",
    "term_length",
    "term_purchase_option",
    "term_offering_class",
]


def parse_product(
    product: Dict[str, Any], region: str
) -> Tuple[ProductModel, list[Price]]:
    sku_id = product["sku_id"]
    hash_str = f"gcp-{region}-{sku_id}"
    product_hash = hashlib.sha256(hash_str.encode()).hexdigest()
    db_product: ProductModel = ProductModel(
        product_hash=product_hash,
        sku=sku_id,
        vendor_name="gcp",
        region=region,
        service=product["service_display_name"],
        product_family=product["product_family"],
        attributes=product["attributes"],
        prices=[],
    )

    prices = []
    for price in product["prices"]:
        price_hash_str = "-".join(
            [str(price[key]) for key in price_hash_keys if key in price]
        )
        price_hash = hashlib.sha256(
            f"{product_hash}-{price_hash_str}".encode()
        ).hexdigest()
        price = Price(
            price_hash=price_hash,
            purchase_option=price["purchase_option"],
            unit=price["unit"],
            usd=price["USD"],
            effective_start_date=price["effective_date_start"],
            start_usage_amount=price["start_usage_amount"],
            end_usage_amount=price["end_usage_amount"],
            product_hash=product_hash,
        )
        prices.append(price)

    return db_product, prices
