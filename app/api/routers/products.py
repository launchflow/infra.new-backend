from typing import Dict, Any, NewType
from fastapi import Depends
from sqlmodel import Session, and_, select
import strawberry
from strawberry.fastapi import GraphQLRouter
import re

from app.db.dependencies import get_db_session
from app.db.models import Price, Product


product_limit = 1000


async def get_context(
    db: Session = Depends(get_db_session),
    # TODO: ensure the user is authenticated
):
    return {
        "db": db,
    }


JSON = strawberry.scalar(
    NewType("JSON", object),
    description="The `JSON` scalar type represents JSON values as specified by ECMA-404",
    serialize=lambda v: v,
    parse_value=lambda v: v,
)


@strawberry.type
class TransformedProductAttribute:
    key: str
    value: str


@strawberry.type
class ApiPrice:
    usd: str | None = None
    purchase_option: str | None = None
    unit: str | None = None

    @classmethod
    def from_storage(cls, price: Price) -> "ApiPrice":
        return cls(
            usd=price.usd,
            purchase_option=price.purchase_option,
            unit=price.unit,
        )


@strawberry.input
class AttributeFilter:
    key: str
    value: str | None = None
    value_regex: str | None = None


@strawberry.input
class ProductFilter:
    vendor_name: str | None = None
    service: str | None = None
    product_family: str | None = None
    region: str | None = None
    attribute_filters: list[AttributeFilter] | None = None


@strawberry.input
class PriceFilter:
    purchase_option: str | None = None
    unit: str | None = None
    usd: str | None = None
    cny: str | None = None
    effective_start_date: str | None = None
    effective_date_end: str | None = None
    start_usage_amount: str | None = None
    end_usage_amount: str | None = None
    term_length: str | None = None
    term_purchase_option: str | None = None
    term_offering_class: str | None = None
    description: str | None = None
    tier_model: str | None = None
    country: str | None = None
    currency: str | None = None
    part_number: str | None = None


@strawberry.type
class ApiProduct:
    product_hash: str
    sku: str
    vendor_name: str
    region: str | None = None
    service: str
    product_family: str = ""
    attributes: JSON
    db_prices: strawberry.Private[list[Price]]

    @classmethod
    def from_storage(cls, product: Product) -> "ApiProduct":
        return cls(
            product_hash=product.product_hash,
            sku=product.sku,
            vendor_name=product.vendor_name,
            region=product.region,
            service=product.service,
            product_family=product.product_family,
            attributes=product.attributes,  # type: ignore
            db_prices=product.prices,
        )

    @strawberry.field
    async def prices(
        self, info: strawberry.Info, filter: PriceFilter | None = None
    ) -> list[ApiPrice]:
        prices_with_filter = []
        for price in self.db_prices:
            if filter:
                if (
                    filter.purchase_option
                    and price.purchase_option != filter.purchase_option
                ):
                    continue
                if filter.unit and price.unit != filter.unit:
                    continue
                if filter.usd and price.usd != filter.usd:
                    continue
                if filter.cny and price.cny != filter.cny:
                    continue
                if (
                    filter.effective_start_date
                    and price.effective_start_date != filter.effective_start_date
                ):
                    continue
                if (
                    filter.effective_date_end
                    and price.effective_date_end != filter.effective_date_end
                ):
                    continue
                if (
                    filter.start_usage_amount
                    and price.start_usage_amount != filter.start_usage_amount
                ):
                    continue
                if (
                    filter.end_usage_amount
                    and price.end_usage_amount != filter.end_usage_amount
                ):
                    continue
                if filter.term_length and price.term_length != filter.term_length:
                    continue
                if (
                    filter.term_purchase_option
                    and price.term_purchase_option != filter.term_purchase_option
                ):
                    continue
                if (
                    filter.term_offering_class
                    and price.term_offering_class != filter.term_offering_class
                ):
                    continue
                if filter.description and price.description != filter.description:
                    continue
                if filter.tier_model and price.tier_model != filter.tier_model:
                    continue
                if filter.country and price.country != filter.country:
                    continue
                if filter.currency and price.currency != filter.currency:
                    continue
                if filter.part_number and price.part_number != filter.part_number:
                    continue
            prices_with_filter.append(price)
        return [ApiPrice.from_storage(p) for p in prices_with_filter]


def str_to_regex(s: str) -> re.Pattern:
    pattern = re.search(r"/(.+)/.*", s)
    options = re.search(r"/.+/(.*)", s)
    return re.compile(
        pattern.group(1) if pattern else "",
        flags=re.IGNORECASE if options and "i" in options.group(1) else 0,
    )


def transform_filter(filter: Dict[str, Any]) -> Dict[str, Any]:
    transformed = {}
    if not filter:
        return transformed
    for key, value in filter.items():
        key_parts = key.split("_")
        op = "$eq"
        if key_parts[-1] == "regex":
            op = "$regex"
            value = str_to_regex(value)
        elif value == "":
            op = "$in"
            value = ["", None]
        transformed[key_parts[0]] = {op: value}
    return transformed


# async def convert_currencies(prices: List[Price]):
#     cc = CurrencyConverter()
#     for price in prices:
#         if price.USD is None and price.CNY is not None:
#             usd = cc.convert(float(price.CNY), 'CNY', 'USD')
#             price.USD = str(usd)


def append_clause(base, clause):
    if base is None:
        return clause
    return and_(base, clause)


@strawberry.type
class Query:
    @strawberry.field
    async def products(
        self, filter: ProductFilter, info: strawberry.Info
    ) -> list[ApiProduct]:
        session: Session = info.context["db"]
        where_clause = None
        if filter.vendor_name:
            where_clause = append_clause(
                where_clause, Product.vendor_name == filter.vendor_name
            )
        if filter.service:
            where_clause = append_clause(
                where_clause, Product.service == filter.service
            )
        if filter.product_family:
            where_clause = append_clause(
                where_clause, Product.product_family == filter.product_family
            )
        if filter.region:
            where_clause = append_clause(where_clause, Product.region == filter.region)

        stmt = select(Product)
        if where_clause is not None:
            stmt = stmt.where(where_clause)  # type: ignore
        stmt = stmt.limit(product_limit)
        products = session.exec(stmt).unique().all()
        return [ApiProduct.from_storage(p) for p in products]

    # @strawberry.field
    # async def product_attributes(self, product: ApiProduct) -> list[TransformedProductAttribute]:
    #     return [TransformedProductAttribute(key=k, value=v) for k, v in product.attributes.items()]

    # @strawberry.field
    # async def product_prices(self, product: ApiProduct, filter: PriceFilter) -> list[ApiPrice]:
    #     # prices = Query(product.prices).find(transform_filter(filter.dict())).all()
    #     # return prices
    #     return []


schema = strawberry.Schema(query=Query)
graphql_app = GraphQLRouter(schema, context_getter=get_context)
