---
name: parc-diagnosis
description: Establish what is actually broken before spending a team on it. Use when Chris reports something not working — "ça marche pas", "ça a l'air bâclé", "j'ai une erreur", "c'est toujours pareil" — or when a team's result contradicts what he observes. Encodes failure modes measured on this parc that have each cost hours.
---

# Diagnosing before dispatching

Chris reports symptoms, not causes, and he reports them briefly. A mandate built on his
sentence alone sends a team to fix whatever that sentence suggested. When the suggestion
is wrong, the team succeeds at the wrong thing and he gets the symptom back unchanged.

Your job here is not to fix. It is to establish the fact well enough that the mandate
aims at something real.

## A narrative is not a measurement

The most expensive mistakes on this project were all made by acting on a story: a team's
report, a plausible hypothesis, your own reasoning from a previous turn. Every one of
them was contradicted by the first real artifact anyone looked at.

Before framing a fix, get one artifact: a log line, a file on disk, a row in a
database, an actual output. You have `lire_fichier` and `rechercher_projets` over
`/mnt/projects`, and you can dispatch a read-access team for anything further. A
diagnostic team is cheap — a few dollars on Sonnet — and it is almost always cheaper than
a write team pointed at the wrong cause.

## Failure modes measured here

**A green fix hiding an intact failure.** A computation replaced a hardcoded constant,
returned the right value in tests, and read a column nothing ever wrote — so it returned
the same constant, by a longer and far more credible path. When a fix replaces a constant
with a computation, the question is not whether the computation is correct. It is whether
what it reads is ever written. Check one real record.

**Deployed to one half of a system.** Files current on disk, the running process still
executing yesterday's code. `systemctl enable --now` does not restart an already-active
service. File presence proves nothing about what is running. When a symptom survives a
verified deploy, the deploy is the first suspect, not the code.

**A front-end symptom that survives a deploy.** Browser cache. Static assets served
without a version fingerprint never reach the browser, reload included. Already-fixed
bugs have been investigated twice here for this reason. One check invalidates or confirms
the whole investigation.

**A conclusion drawn from two variables at once.** Before generalizing from an
observation, list everything that differed between the passing case and the failing one,
and vary exactly one. It is usually two commands, and it is what separates a fact from a
plausible story.

**A verdict that outlived its window.** A state marked from a measurement taken days ago
is not current because nothing contradicted it. Re-evaluate time-bound conclusions
against the clock, not against the last reading.

## When his observation contradicts a team's report

Both can be sincere. The team tested what it built; he used what got deployed. The gap is
usually between those two, not inside either.

Ask for the artifact he already has — the error text, what he clicked, what appeared. He
gives it readily and it costs him one line. Then aim the diagnostic at the gap.

Never ask him to inspect code, read a file, or check a tool list to help you diagnose.
That is the boundary that matters most, and it is the one most easily crossed while
troubleshooting.

## Framing the diagnostic mandate

Access `lecture`. Sonnet, high effort. A small ceiling.

The objective is a finding, not a fix: what the defect actually is, where it lives, and
what would prove it. The stop criterion is that the team can name the cause and point at
the evidence for it.

Then decide the fix with what it found. Two mandates cost less than one write team that
guessed.

## Reporting back

Give Chris the cause in plain French and the proposed action. Not the file, not the
function, not the line. What was wrong, what it broke, what you are doing about it.
