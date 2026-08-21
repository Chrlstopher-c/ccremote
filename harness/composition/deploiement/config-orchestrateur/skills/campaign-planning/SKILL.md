---
name: campaign-planning
description: Plan a piece of work that clearly needs more than one team, before launching any of them. Use when Chris describes a project rather than a task — "construis X", "on refait Y", "monte le lab" — or when framing a mandate reveals the work does not fit in one team. Prevents wave-by-wave accumulation.
---

# Planning a campaign

## The failure this prevents

On 1 August a showcase site was built in six successive waves — `FONDATION`, `VAGUE 2`,
`CONSOLIDATION`, `VAGUE 3`, `VAGUE 4`, `PASSE TECHNIQUE`. Total: 52,93 $, none below
3,85 $, one cut mid-work by its own ceiling.

That split was never decided. It accumulated: each team finished in a state that created
the need for the next one. Every wave re-paid for the design decisions the previous wave
had already made, because no wave inherited them in writing.

The cost of the plan that would have prevented it: one turn.

The trigger that matters is not only before the first team — it is a team finishing in a
state that creates the need for another one. That moment is a wave forming in real time.
Stop there and decide whether the rest is now a campaign, before framing the next mandate
as if it were a one-off.

## Design once, at the front

Anything that is a judgement call — art direction, architecture, data model, the shape of
the interface — gets decided once, before execution starts, and written down. It becomes
an input to every team that follows.

Split it across waves and you pay for it at every wave, with a different answer each
time. That is what produces work that looks assembled from unrelated pieces.

If the design decision genuinely needs its own team, that team's deliverable is a
document, and its access is `lecture`. Everything after it is execution on Sonnet.

## What a step is

A step produces something you can name and check. A page that renders. A build that
passes. A document that exists. If you cannot name the deliverable, the step is not a
step — it belongs to the one before it. Merge instead of adding a wave.

Each step also states what must be true before the next one can start. That condition is
what turns a list into a plan.

## Write it to Chris first

A few lines, in French, before anything launches:

- the steps, in order, and what each produces
- which are design and which are execution, and therefore which model
- what must hold between two steps
- the rough total cost

He does not need the technical reasoning. He needs to see the shape and the price, and
to be able to say `non, commence par autre chose`.

This plan is not a mandate. The first team still waits for his click. But once he has
clicked, run the whole sequence without asking again — that is what his autonomy window
is for, and asking at every step is the behaviour he called `tu attend trop apres moi`.

## While it runs

Watch teams with `suivre_equipes` when several are active — one call, one comparable
view. If a team is heading for a conclusion that misses something, `envoyer_a_equipe`
corrects it in flight without interrupting its turn. Almost always better than a new team
for a detail: the current one still holds all its context.

When a step fails, do not launch the next one on top of it. Establish what the failure
actually was, then decide: relaunch the same step with a sharper mandate, or tell Chris
the plan needs changing.

## Revising

A plan that survives contact unchanged was probably too vague. Revising is normal.
Revising silently is not — if the sequence changes, say so in one line and say why. And
withdraw any pending mandate you are replacing with `retirer_mandat`, otherwise it stays
approvable and will eventually be approved, against the wrong version of the plan.
