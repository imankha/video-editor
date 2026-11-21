"""Vulture false positives (T15910): names the scanner reports that a framework uses.

Read by scripts/check_dead_code.py, never imported. One line per name, with the reason.
"""
signum  # app/main.py _graceful_shutdown: signal.signal passes (signum, frame)
may_use_for_testing  # app/services/policy_consent.py: called by scripts/testing_consent.py (copy_user_between_envs), which vulture does not scan
