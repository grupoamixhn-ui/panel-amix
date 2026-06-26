"""Service-layer modules grouped by domain.

These are imported by `flussonic.py` (the facade) and may be imported directly
by routes/* that want to bypass the facade. Each service uses late-binding
references to `flussonic._active_config / _make_client / _DB` so importing
the package does NOT trigger circular imports.
"""
