"""Make sibling hook modules importable regardless of the host project's
pytest configuration. Projects that set --import-mode=importlib (or any
config that keeps test directories off sys.path) would otherwise break
`import _hook_runtime` in the hook self-tests."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
