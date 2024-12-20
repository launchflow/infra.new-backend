from fastapi import APIRouter

from app.api.routers import integrations
from app.api.routers import products

v1_router = APIRouter(prefix="/v1", tags=["v1"])
v1_router.include_router(integrations.router)
v1_router.include_router(products.graphql_app, prefix="/products/graphql", tags=["products"])

__all__ = ["v1_router"]
