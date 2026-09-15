# Anthropic / Claude Configuration — and the Safe Kill Switch

## Build the real integration first

`agents/llm.py` wraps the real Anthropic API (`complete_json`, usage
logging). `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are real, functional
config values — this is not a stub. The current cost-efficient default
model for this kind of structured-output task is `claude-haiku-4-5`;
override with a stronger model via `ANTHROPIC_MODEL` when quality matters
more than cost for a given deployment.

## Then wire a single, explicit disable flag

```python
class Settings:
    ...
    # Explicitly disabled by request: no agent may call the Anthropic API
    # while this is True, even if a valid ANTHROPIC_API_KEY is present.
    ANTHROPIC_DISABLED: bool = True

    @property
    def llm_enabled(self) -> bool:
        if self.ANTHROPIC_DISABLED:
            return False
        return bool(self.anthropic_api_key)
```

Every agent gates its Claude call behind `settings.llm_enabled` — checked
this way, one boolean forces the entire pipeline onto local deterministic
analyzers without touching agent code or deleting the integration. This is
the pattern to copy: **never delete a real integration to save cost — gate
it behind a flag that's trivially reversible.**

## Why this project disables it

Real-world reason worth preserving in any rebuild: a single verified,
real end-to-end test was run against a real GitHub repo with real Claude
API calls (a few cents of cost), to prove the integration actually works —
then Anthropic was deliberately disabled to avoid further ongoing cost
while the app is used for demos/homework. This is a legitimate,
intentional operational decision, not a broken feature. **Never silently
flip `ANTHROPIC_DISABLED` back to enabled** without an explicit request —
doing so would start incurring real API cost the user didn't ask for.

## Surface this honestly in the UI

The Settings page's System panel should show the current state truthfully,
e.g.:

```
Analysis engine: Local analyzers   (not "Claude API" when llm_enabled is False)
Model: — (only shown if llm_enabled)
```

And an explicit note when disabled: *"No `ANTHROPIC_API_KEY` is configured
[or: Anthropic is disabled], so the agents are running their local
deterministic analyzers. Findings, consolidation and reports are produced by
the same pipeline either way."* Don't let the UI imply Claude is doing the
analysis when it isn't — this is the same honesty principle that governs the
Social Accounts demo features (`07-social-accounts-demo.md`).
