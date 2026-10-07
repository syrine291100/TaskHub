from datetime import datetime, timedelta, timezone
import jwt
from security import SECRET


def create_task(client, headers, project, columns, **overrides):
    r = client.post(f'/projects/{project}/tasks', headers=headers, json={'title': 'Tester le parcours', 'column_id': columns[0]['id'], **overrides})
    assert r.status_code == 201, r.text
    return r.json()

def test_registration_login_and_duplicate(client, account):
    h = account()
    assert client.get('/auth/me', headers=h).json()['email'] == 'alice@example.com'
    login = client.post('/auth/login', json={'email': 'ALICE@example.com', 'password': 'A-valid-password!123'})
    assert login.status_code == 200
    assert client.post('/auth/register', json={'name': 'Again', 'email': 'alice@example.com', 'password': 'password123'}).status_code == 409
    assert client.post('/auth/login', json={'email': 'alice@example.com', 'password': 'wrong'}).status_code == 401
    assert client.post('/auth/login', json={'email': 'absent@example.com', 'password': 'wrong'}).status_code == 401

def test_task_lifecycle_filters_and_stats(client, setup_project):
    h, w, p, columns = setup_project()
    t = create_task(client, h, p, columns, due_date='2000-01-01', priority='high', description='API à tester')
    board = client.get(f'/projects/{p}/board?q=API&priority=high', headers=h).json()
    assert len(board['tasks']) == 1
    assert board['stats'] == {'total': 1, 'done': 0, 'overdue': 1}
    assert client.get(f'/projects/{p}/board?q=inexistant', headers=h).json()['tasks'] == []
    r = client.patch(f'/tasks/{t["id"]}', headers=h, json={'title': 'Testé', 'column_id': columns[2]['id'], 'due_date': None})
    assert r.status_code == 200
    assert r.json()['due_date'] is None
    assert client.get(f'/projects/{p}/board', headers=h).json()['stats'] == {'total': 1, 'done': 1, 'overdue': 0}
    assert client.delete(f'/tasks/{t["id"]}', headers=h).status_code == 204
    assert client.patch(f'/tasks/{t["id"]}', headers=h, json={'title': 'Gone'}).status_code == 404

def test_project_edit_and_cascade_delete(client, setup_project):
    h, w, p, columns = setup_project()
    create_task(client, h, p, columns)
    assert client.patch(f'/projects/{p}', headers=h, json={'name': 'Renommé', 'description': None}).json()['name'] == 'Renommé'
    assert client.delete(f'/projects/{p}', headers=h).status_code == 204
    assert client.get(f'/projects/{p}/board', headers=h).status_code == 404
    assert client.get(f'/workspaces/{w}/projects', headers=h).json() == []

def test_data_isolation(client, setup_project):
    a, wa, pa, ca = setup_project()
    t = create_task(client, a, pa, ca)
    b, wb, pb, cb = setup_project('bob@example.com')
    for path in [f'/projects/{pa}/board', f'/workspaces/{wa}/projects', f'/workspaces/{wa}/members']:
        assert client.get(path, headers=b).status_code == 404
    assert client.patch(f'/tasks/{t["id"]}', headers=b, json={'title': 'Intrusion'}).status_code == 404
    assert client.delete(f'/tasks/{t["id"]}', headers=b).status_code == 404
    assert client.delete(f'/projects/{pa}', headers=b).status_code == 404
    assert client.post(f'/projects/{pa}/tasks', headers=b, json={'title': 'Intrusion', 'column_id': ca[0]['id']}).status_code == 404

def test_cross_project_column_and_nonmember_assignment_rejected(client, setup_project):
    a, wa, pa, ca = setup_project()
    b, wb, pb, cb = setup_project('bob@example.com')
    bob = client.get('/auth/me', headers=b).json()['id']
    assert client.post(f'/projects/{pa}/tasks', headers=a, json={'title': 'Wrong column', 'column_id': cb[0]['id']}).status_code == 422
    assert client.post(f'/projects/{pa}/tasks', headers=a, json={'title': 'Wrong assignee', 'column_id': ca[0]['id'], 'assignee_id': bob}).status_code == 422
    t = create_task(client, a, pa, ca)
    assert client.patch(f'/tasks/{t["id"]}', headers=a, json={'column_id': cb[0]['id']}).status_code == 422

def test_collaboration_and_owner_permissions(client, setup_project):
    a, wa, pa, ca = setup_project()
    b, wb, pb, cb = setup_project('bob@example.com')
    path = f'/workspaces/{wa}/members'
    assert client.post(path, headers=a, json={'email': 'bob@example.com'}).status_code == 201
    assert client.post(path, headers=a, json={'email': 'bob@example.com'}).status_code == 409
    assert client.post(path, headers=b, json={'email': 'alice@example.com'}).status_code == 403
    assert client.post(path, headers=a, json={'email': 'absent@example.com'}).status_code == 404
    bob = client.get('/auth/me', headers=b).json()['id']
    t = create_task(client, b, pa, ca, assignee_id=bob)
    assert client.patch(f'/tasks/{t["id"]}', headers=a, json={'assignee_id': None}).json()['assignee_id'] is None
    assert client.delete(f'/projects/{pa}', headers=b).status_code == 403

def test_input_validation(client, setup_project):
    h, w, p, columns = setup_project()
    for title in ['', '   ', 'x'*201]:
        assert client.post(f'/projects/{p}/tasks', headers=h, json={'title': title, 'column_id': columns[0]['id']}).status_code == 422
    t = create_task(client, h, p, columns)
    for body in [{'title': None}, {'priority': 'urgent'}, {'column_id': None}, {'project_id': 999}, {'due_date': 'bad-date'}]:
        assert client.patch(f'/tasks/{t["id"]}', headers=h, json=body).status_code == 422
    assert client.get(f'/projects/{p}/board?priority=urgent', headers=h).status_code == 422

def test_authentication_required_expired_and_forged_tokens(client, account):
    h = account()
    assert client.get('/workspaces').status_code == 401
    user = client.get('/auth/me', headers=h).json()
    now = datetime.now(timezone.utc)
    expired = jwt.encode({'sub': str(user['id']), 'iat': now-timedelta(days=1), 'exp': now-timedelta(hours=1)}, SECRET, algorithm='HS256')
    forged = jwt.encode({'sub': str(user['id']), 'iat': now, 'exp': now+timedelta(hours=1)}, 'other-secret-other-secret-other-secret', algorithm='HS256')
    for token in [expired, forged, 'garbage']:
        assert client.get('/workspaces', headers={'Authorization': f'Bearer {token}'}).status_code == 401

def test_workspace_creation(client, account):
    h = account()
    r = client.post('/workspaces', headers=h, json={'name': 'Équipe'})
    assert r.status_code == 201
    assert len(client.get('/workspaces', headers=h).json()) == 2
    assert client.get(f'/workspaces/{r.json()["id"]}/members', headers=h).json()[0]['role'] == 'owner'

def test_cors(client):
    r = client.options('/auth/login', headers={'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'POST'})
    assert r.headers['access-control-allow-origin'] == 'http://localhost:3000'
    r = client.options('/auth/login', headers={'Origin': 'https://untrusted.example', 'Access-Control-Request-Method': 'POST'})
    assert 'access-control-allow-origin' not in r.headers
