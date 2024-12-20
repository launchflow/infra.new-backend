from fastapi import Depends, FastAPI
from sqlmodel import Session

from app.api import routers
from app.db.dependencies import get_db_session


app = FastAPI()
app.include_router(routers.v1_router)


@app.get("/healthz")
async def root(db: Session = Depends(get_db_session)):
    return {"status": "healthy"}
