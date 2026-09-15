"""Check template serving and synchronous agent calls without external services."""
import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient


class FrontendTests(unittest.TestCase):
    def setUp(self):
        backend = types.ModuleType('backend')

        def result(**kwargs):
            async def mcp_result():
                return {'thread_id': 'test-thread', 'answer': 'A trip', 'requires_approval': False}
            return asyncio.run(mcp_result())

        backend.run_travel_agent = result
        backend.resume_travel_agent = result
        spec = importlib.util.spec_from_file_location('trip_app_test', Path(__file__).resolve().parents[1] / 'app.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'backend': backend}):
            spec.loader.exec_module(module)
        self.client = TestClient(module.app)

    def test_template_and_assets(self):
        self.assertIn('Where are we heading?', self.client.get('/').text)
        for path in ['/static/style.css', '/static/script.js']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.text)

    def test_agents_can_run_async_helpers(self):
        response = self.client.post('/api/travel', json={'message': 'Japan'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        response = self.client.post('/api/travel/approve', json={'thread_id': 'test-thread', 'approved': True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])

    def test_invalid_input(self):
        self.assertEqual(self.client.post('/api/travel', json={'message': ' '}).status_code, 400)
        self.assertEqual(self.client.post('/api/travel/approve', json={'thread_id': 'test-thread', 'approved': False, 'feedback': ' '}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
