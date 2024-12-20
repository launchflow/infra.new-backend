from enum import Enum
from typing import Dict

import sqlalchemy
from sqlmodel import JSON, Column, Field, Relationship, SQLModel


class UserType(Enum):
    FREE = "free"
    PRO = "pro"


class User(SQLModel, table=True):
    id: str = Field(default=None, primary_key=True)
    stripe_customer_id: str | None
    user_type: UserType


class Product(SQLModel, table=True):
    product_hash: str = Field(primary_key=True)
    sku: str
    vendor_name: str
    region: str | None = None
    service: str
    product_family: str = ""
    attributes: Dict = Field(default_factory=dict, sa_column=Column(JSON))

    prices: list["Price"] = Relationship(
        back_populates="product", sa_relationship_kwargs={"lazy": "joined"}
    )

    __table_args__ = (sqlalchemy.Index("idx_service_region", "service", "region"),)


class Price(SQLModel, table=True):
    price_hash: str = Field(primary_key=True)
    purchase_option: str
    unit: str
    usd: str | None
    cny: str | None = None
    effective_start_date: str
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

    product_hash: str = Field(foreign_key="product.product_hash")

    product: Product = Relationship(back_populates="prices")
