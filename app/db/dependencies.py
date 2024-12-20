import os
import tempfile
from app import settings
import ssl
from sqlmodel import Session, create_engine
from .models import SQLModel
from google.cloud.sql.connector import Connector, IPTypes


def load_cert_chain_from_strings(cert_string, key_string, password=None):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)

    # Create temporary files
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as cert_file:
        cert_file.write(cert_string)
        cert_file_path = cert_file.name

    with tempfile.NamedTemporaryFile(mode="w", delete=False) as key_file:
        key_file.write(key_string)
        key_file_path = key_file.name

    try:
        context.load_cert_chain(
            certfile=cert_file_path, keyfile=key_file_path, password=password
        )
    finally:
        # Clean up temporary files
        os.unlink(cert_file_path)
        os.unlink(key_file_path)

    return context


if settings.instance_connection_name is not None:
    instance_connection_name = settings.instance_connection_name
    db_user = settings.db_user
    db_pass = settings.db_password
    db_name = settings.db_name
    if not all([instance_connection_name, db_user, db_pass, db_name]):
        raise ValueError(
            "Must set all INSTANCE_CONNECTION_NAME, DB_USER, DB_PASSWORD, and DB_NAME env vars"
        )

    ip_type = IPTypes.PRIVATE if settings.db_private_ip else IPTypes.PUBLIC
    connector = Connector()

    def getconn():
        conn = connector.connect(
            instance_connection_name,
            "pg8000",
            user=db_user,
            password=db_pass,
            db=db_name,
            ip_type=ip_type,
        )
        return conn

    engine = create_engine("postgresql+pg8000://", creator=getconn)
else:
    engine = create_engine(settings.db_url)


SQLModel.metadata.create_all(engine)


def get_db_session():
    with Session(engine) as session:
        yield session
