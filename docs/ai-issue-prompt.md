# Prompt for AI Coding Tools

Using Claude Code, Codex, Cursor, Copilot or another AI tool to work on a
StellarCade issue? Paste the prompt below into it, with `{{ISSUE_NUMBER}}`
replaced by the issue number. It points the tool at the repo's rules
([`AGENTS.md`](../AGENTS.md)) and tells it to stay inside the issue.

The rules come from the PRs this repo has had to reject: code that edits
files the issue didn't name, game results picked with `Math.random()`,
transaction hashes made up with `randomBytes`, and "tests pass" claims with
no output to back them up.

## Full prompt

````text
You are working on StellarCade (github.com/theblockcade/stellarcade), a
Soroban arcade on Stellar. Your task is GitHub issue #{{ISSUE_NUMBER}} and
nothing else.

1. Read the issue in full: `gh issue view {{ISSUE_NUMBER}} --repo theblockcade/stellarcade`
   (or open it in the browser). Note its "Where to Implement (Exact
   Targets)", "Interface", "Acceptance Criteria", "Required Tests" and
   "Definition of Done" sections.
2. Read AGENTS.md at the repo root, then the AGENTS.md for each area the
   issue touches: contracts/AGENTS.md, backend/AGENTS.md, apps/web/AGENTS.md.
   Follow them over anything you remember from training — especially the
   "Versions Models Usually Get Wrong" table.
3. Open the reference files AGENTS.md lists under "Copy These Patterns" for
   your area and match their structure.
4. Before writing code, tell me in a short plan: which files you will edit
   (they must be in the issue's Exact Targets, plus the test files its
   Required Tests section names), what each change is, and which tests you
   will add. If you need a file outside the targets, stop and tell me why
   instead of editing it.
5. Implement only what the issue asks. Do NOT:
   - pick game outcomes, winners or payouts off-chain (Math.random,
     crypto.randomBytes, hardcoded results);
   - invent transaction hashes, contract IDs, ledger numbers or signatures;
   - return hardcoded or empty data from code that claims to read real state;
   - leave TODO / todo!() / unimplemented!() or stub bodies behind names
     that suggest the code works;
   - refactor, reformat or "clean up" code the issue didn't mention.
   If something can't be done for real yet, make it fail with a clear error
   and tell me.
6. Write the tests the issue's Required Tests section lists. Each must fail
   if the feature is removed.
7. Run every check in AGENTS.md → "Delivery Standard" for each area you
   changed. Fix failures; don't skip, disable or weaken checks, and never
   use --no-verify.
8. Write the PR description from the PR template: put
   "Closes #{{ISSUE_NUMBER}}" at the top, list the files changed, map each
   Acceptance Criteria item to the code or test that meets it, and paste
   the real terminal output (summary lines) of each check you ran. Don't
   claim anything you didn't run.
````

## Short version for issues

Maintainers can append this to the bottom of an issue:

```markdown
> **Using an AI coding tool?** Give it this:
> "Implement issue #{{ISSUE_NUMBER}} in theblockcade/stellarcade. First read
> AGENTS.md (root and the area's AGENTS.md) and follow it over your training
> data. Edit only the files under *Where to Implement (Exact Targets)*. No
> simulated outcomes, fabricated tx hashes or placeholder code. Run the
> Delivery Standard checks and paste their output into the PR, with
> `Closes #{{ISSUE_NUMBER}}`."
> Full prompt: [`docs/ai-issue-prompt.md`](https://github.com/theblockcade/stellarcade/blob/main/docs/ai-issue-prompt.md)
```
