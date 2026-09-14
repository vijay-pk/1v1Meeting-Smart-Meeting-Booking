import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000/api"
headers = {"Content-Type": "application/json"}

# Test 1: Signup
print("1. Testing new admin signup...")
signup_data = {
    "name": "Test Admin",
    "email": f"testadmin{int(time.time())}@test.com",
    "username": f"testadmin{int(time.time())}",
    "password": "TestPassword123!",
    "phone": "+919876543210"
}

resp = requests.post(f"{BASE_URL}/auth/signup", json=signup_data, headers=headers)
print(f"   Signup response: {resp.status_code}")
if resp.status_code == 200:
    body = resp.json()
    token = body.get("access_token")
    user_id = body.get("user_id")
    print(f"   ✓ Signup successful. Token: {token[:20]}...")
    print(f"   User ID: {user_id}")
    
    # Test 2: Check sessions (should have 2 defaults)
    print("\n2. Checking admin sessions (should have 2 defaults)...")
    auth_headers = {**headers, "Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/sessions/", headers=auth_headers)
    print(f"   Sessions response: {resp.status_code}")
    if resp.status_code == 200:
        sessions = resp.json()
        print(f"   ✓ Found {len(sessions)} sessions")
        for s in sessions:
            print(f"     - {s['title']}: ₹{s['price']/100 if s['price'] else 'Free'} ({s['duration_minutes']}m)")
        if len(sessions) == 2:
            print("   ✓ PASS: Exactly 2 default sessions created")
        else:
            print(f"   ✗ FAIL: Expected 2 sessions, got {len(sessions)}")
    else:
        print(f"   ✗ Error: {resp.text}")
    
    # Test 3: Check profile
    print("\n3. Checking admin profile...")
    resp = requests.get(f"{BASE_URL}/profiles/me", headers=auth_headers)
    print(f"   Profile response: {resp.status_code}")
    if resp.status_code == 200:
        profile = resp.json()
        print(f"   ✓ Profile loaded")
        print(f"     Username: {profile.get('username')}")
        print(f"     Title: {profile.get('title')}")
        print(f"     Bio: {profile.get('bio')[:50]}..." if profile.get('bio') else "     Bio: (empty)")
    else:
        print(f"   ✗ Error: {resp.text}")
else:
    print(f"   ✗ Signup failed: {resp.status_code}")
    print(f"   Response: {resp.text}")

print("\n4. Testing public profile access...")
username = signup_data["username"]
resp = requests.get(f"{BASE_URL}/profiles/public/{username}")
print(f"   Public profile response: {resp.status_code}")
if resp.status_code == 200:
    print("   ✓ Public profile accessible")
else:
    print(f"   ✗ Error: {resp.text}")

