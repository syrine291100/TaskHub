import os
import sys
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'test-only-secret-never-use-in-production-123456')
from database import Base, get_db
from main import app

@pytest.fixture
def client():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    from sqlalchemy import event
    @event.listens_for(engine, 'connect')
    def enable_fk(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    def override():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()

@pytest.fixture
def account(client):
    def create(email='alice@example.com'):
        r = client.post('/auth/register', json={'name': 'Alice', 'email': email, 'password': 'A-valid-password!123'})
        assert r.status_code == 201, r.text
        return {'Authorization': 'Bearer ' + r.json()['access_token']}
    return create

@pytest.fixture
def setup_project(client, account):
    def create(email='alice@example.com'):
        headers = account(email)
        w = client.get('/workspaces', headers=headers).json()[0]['id']
        p = client.post(f'/workspaces/{w}/projects', headers=headers, json={'name': 'Portfolio', 'description': 'Livrer la V1'}).json()['id']
        columns = client.get(f'/projects/{p}/board', headers=headers).json()['columns']
        return headers, w, p, columns
    return create
