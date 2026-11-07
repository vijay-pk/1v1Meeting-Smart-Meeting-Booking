from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

# Create engine with appropriate options for sqlite vs postgres
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Every request borrows a connection. `pool_pre_ping=True` made each borrow a "SELECT 1" round trip
# first -- with the database in another region that is hundreds of milliseconds added to every API
# call, even when the connection was used a second ago. The check below pings only a connection
# that has sat idle long enough to have been dropped by the server or pooler, so a hot connection
# is handed over at once and a dead one is still replaced before a request sees it.
_IDLE_PING_AFTER_SECONDS = 30

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
pool_options = {} if is_sqlite else {
    "pool_pre_ping": False,
    "pool_size": 5,
    "max_overflow": 5,
    "pool_timeout": 30,
    "pool_recycle": 280,
}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **(pool_options if not is_sqlite else {"pool_pre_ping": True})
)

if not is_sqlite:
    import time
    from sqlalchemy import event, exc

    @event.listens_for(engine, "checkin")
    def _stamp_checkin(dbapi_conn, record):
        record.info["last_checkin"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _ping_if_idle(dbapi_conn, record, proxy):
        last = record.info.get("last_checkin")
        if last is None or time.monotonic() - last < _IDLE_PING_AFTER_SECONDS:
            return
        cursor = dbapi_conn.cursor()
        try:
            cursor.execute("SELECT 1")
        except Exception as err:  # noqa: BLE001 -- any failure means the connection is unusable
            # SQLAlchemy discards this connection and retries the checkout with a fresh one.
            raise exc.DisconnectionError() from err
        finally:
            cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
