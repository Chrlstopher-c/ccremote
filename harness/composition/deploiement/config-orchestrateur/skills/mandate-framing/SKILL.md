---
name: mandate-framing
description: Write a mandate a team cannot misread. Use before every creer_equipe call — when Chris says "envoie une team", "lance un mandat", "occupe-toi de X", or when you are about to dispatch on your own initiative. Covers the six required decisions, the stop criterion most mandates omit, and how to make the result verifiable.
---

# Framing a mandate

The mandate is the one thing you produce that nobody reviews before it costs money. A
team runs on it for hours. Chris has called finished work `bâclé` more than once, and
every time the cause was traceable to the framing, not to the team.

## What the team actually receives

Your mandate becomes the lead's system prompt. It is the only part of the briefing that
survives compaction — everything else the lead reads can be summarized away halfway
through a long run. Write it as the permanent charter of the work, not as an opening
message.

The lead cannot ask you anything. It cannot see Chris. It cannot read this conversation.
Anything you know and do not write is lost.

## Six decisions, all mandatory

**Objective.** The result, not the subject. `Améliorer l'app Diapason` names a topic and
guarantees drift. `Faire fonctionner la génération de voix de bout en bout depuis
l'interface, avec un fichier audio lisible en sortie` names a result.

**Stop criterion.** The most frequently omitted, and the one that decides whether the
work is finished or merely abandoned. It must be something the lead can check itself:
a command that exits clean, a page that loads without console errors, a file that
exists and plays. `Quand ce sera propre` is not a criterion.

**Scope.** The project path, and what is explicitly out of bounds. When Chris has ruled
something out — he said `ne me parle pas de physique domotique, c'est clairement pas pour
maintenant` — write the exclusion into the mandate. A team that has not been told will
helpfully do it anyway.

**Access.** `lecture` or `ecriture`, and it is a real lock the harness places on the
team's tools. Read whenever a report satisfies the objective: audit, diagnosis, review,
exploration. Write only when the objective requires changing the project. Doubt resolves
to read — a team that discovers it needs to write will say so, and you can relaunch.
Granting write "just in case" does not undo.

**Model and effort.** Sonnet 5 at high effort for execution work, where the framing
already exists and the job is to write, fix, test, explore, document, wire. This is most
mandates. Opus 5 at high effort when the decision is part of the work: art direction,
motion, non-trivial architecture, a defect that has already resisted one attempt.
Measured on this parc: 6,40 $ per Opus team against 0,67 $ per Sonnet team.

**Spending ceiling.** Always set it, sized to the work. A few dollars for a check, ten
or so for a real piece of work. Left empty it inherits the parc ceiling, which is a
safety net rather than a decision — and a short mission finishes before any monitoring
could catch it.

## What to write, and what to leave out

Say what to obtain and how the team will know it succeeded. Do not say how to implement
it — you are framing the work, not doing it, and a lead constrained to your approach
cannot use what it finds on the ground.

Two exceptions, where you must be prescriptive: constraints that come from Chris (a
stack, a library, an exclusion), and facts the team cannot discover on its own.

When a screenshot or a log from Chris informs the work, **describe its content in words**.
The file sits on the Pi; a team working on the PC or the VPS cannot open that path.

Ground the framing before you write it. `explorer_projets` for the layout,
`rechercher_projets` to find, `lire_fichier` to confirm. A mandate written blind produces
a team that spends its first hour rediscovering what you could have stated in a line.

## Before you call the tool

Reread the mandate as if you were the lead, with no other context:

Can I tell what "done" looks like without asking anyone? Do I know what I must not touch?
Do I know how to verify my own result?

A no to any of those is a mandate that will come back as `bâclé`, and it will not be the
team's fault.

## Multiple teams

When the work visibly exceeds one team, do not dispatch the first one and improvise the
rest. Load `campaign-planning` and write the sequence first.
