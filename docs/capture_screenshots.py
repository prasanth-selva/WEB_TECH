from pathlib import Path
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:3000'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1600, 'height': 1100}, device_scale_factor=1)
    page = context.new_page()
    page.goto(BASE, wait_until='networkidle')
    page.screenshot(path=str(OUT / '01-sign-in.png'), full_page=True)
    page.locator('#demoLogin').click()
    page.locator('.task-card').first.wait_for(timeout=10000)
    page.wait_for_timeout(1000)
    token = page.evaluate("sessionStorage.getItem('pulseboard_token')")
    page.evaluate("""async token => {
      const r = await fetch('/api/tasks', {headers: {Authorization: `Bearer ${token}`}});
      const data = await r.json();
      for (const task of data.data.tasks.filter(t => t.title === 'Share the live demo with the class')) {
        await fetch(`/api/tasks/${task.id}`, {method: 'DELETE', headers: {Authorization: `Bearer ${token}`}});
      }
    }""", token)
    page.locator('.task-card h4', has_text='Share the live demo with the class').wait_for(state='detached', timeout=5000)
    other = context.new_page()
    other.goto(BASE, wait_until='domcontentloaded')
    account = other.evaluate("""async suffix => {
      const r = await fetch('/api/auth/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Jordan Lee',email:`jordan-${suffix}@pulseboard.app`,password:'Classroom2026!'})});
      return r.json();
    }""", str(time.time_ns()))
    if not account.get('success'):
        raise RuntimeError(f"Could not create the second screenshot account: {account}")
    other.evaluate("token => sessionStorage.setItem('pulseboard_token', token)", account['data']['token'])
    other.reload(wait_until='networkidle')
    other.locator('.task-card').first.wait_for(timeout=10000)
    other.locator('#newTaskButton').click()
    other.locator('#taskTitle').fill('Share the live demo with the class')
    other.locator('#taskDescription').fill('Updates travel over Socket.IO and are persisted through the REST API.')
    other.locator('#taskPriority').select_option('high')
    other.locator('#saveTaskButton').click()
    page.locator('.task-card h4', has_text='Share the live demo with the class').wait_for(timeout=10000)
    page.locator('.activity-item', has_text='Jordan Lee').first.wait_for(timeout=10000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / '02-live-classroom-board.png'), full_page=True)
    print('Captured:', *(str(p) for p in sorted(OUT.glob('*.png'))), sep='\n')
    browser.close()
