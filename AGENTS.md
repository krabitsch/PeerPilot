# Peerofessor development instructions

## Project

Peerofessor is a peer-to-peer learning and evaluation platform derived from
the 42 ft_transcendence project.

Repository root:
~/Peerofessor

Main working branch:
develop_katrin

Stack:
- Angular frontend
- Node/Express backend
- Prisma ORM
- PostgreSQL
- Docker Compose
- MinIO file storage

The current application is used for MA Economics teaching.

## Working style

When asked to implement a change:

1. Inspect the relevant existing files first.
2. Understand the current implementation before editing.
3. Implement the requested change directly in the repository.
4. Do not merely give the user instructions for edits unless explicitly asked.
5. Preserve existing working functionality unless the task requires changing it.
6. Run appropriate targeted checks/tests after editing.
7. Fix errors caused by your changes.
8. At the end, briefly report:
   - files changed
   - what changed
   - checks/tests run
   - anything still requiring user action

If there is genuine architectural ambiguity, explain the issue and ask before
making a consequential design decision.

Do not ask for confirmation for straightforward implementation details.

## Safety / database

Never run these commands unless the user explicitly asks:

- make fclean
- make populateDB
- destructive Prisma reset commands
- database volume deletion
- commands that wipe current test data

Do not delete migrations or rewrite migration history without explicit approval.

Prefer migrations that preserve existing development data.

## Frontend

Frontend source:
src/frontend

Development server:
cd ~/Peerofessor/src/frontend
npm start -- --proxy-config proxy.conf.json

Typical URL:
http://localhost:4200

Angular development server watches files automatically.

For frontend-only changes, do not rebuild the full Docker stack unless necessary.

Existing compiler warnings about unused imports are not blockers unless the task
is specifically cleanup.

## Backend

Backend source:
src/api/src

After backend changes, use targeted syntax/tests where possible before rebuilding.

For JavaScript syntax checks, for example:
node --check src/api/src/modules/eval/service.js

The API normally runs in Docker.

Be aware that changes to Prisma schema/client code may require rebuilding the API
container so the generated Prisma client inside Docker is current.

## Prisma/database

Schema:
src/packages/database/prisma/schema.prisma

Prisma utilities:
src/packages/utils/src

When schema changes are required:
- edit schema.prisma
- create a normal Prisma migration
- regenerate Prisma client
- preserve existing data

Do not use make populateDB merely to apply schema changes.

## Current course model

Peerofessor course:
Foundations of Macroeconomics

Term:
Fall 2026

Official WU course numbers:
- 1268
- 1269
- 1421

All three official course-number groups belong to the same Peerofessor course.
Grouping and peer-evaluation pairings operate across all three numbers.

The external course number is enrollment metadata only and must not split
grouping or evaluation pairing logic.

## Current enrollment model

Class has:
- term
- externalCourseCodes

Enrollment has:
- externalCourseCode

AllowedEnrollment stores:
- email
- classId
- externalCourseCode

Students may self-enroll only if their email is whitelisted and must use the
external course code assigned to them.

## Evaluation model

EvalAssignment represents one evaluator/evaluee pairing for one round.

Current design direction:
- each EvalAssignment has its own passKey
- passKey belongs to EvalAssignment, not User
- evaluatorUser should be returned by the Eval API with id and username
- the student assignment-detail page displays one row per required evaluation:
  Evaluation N / evaluator / eval passkey / status

Do not revert to one shared Submission passkey for all evaluation pairings.

## UX conventions

The user wants a clean dark Peerofessor UI.

For student Assignment Detail:
- keep assignment header and assignment description
- keep Your Group
- after submission closes, show Submitted files
- show a separate Evaluations box with one row per evaluation round
- later Grade & Feedback should also be organized by Evaluation 1 / 2 / 3

Keep existing reusable design-system components where appropriate.

## Collaboration style

The user wants to understand the architectural reasoning, but does not want to
manually search for edit locations and copy many small snippets.

Therefore:
- explain important design decisions briefly
- then implement them directly
- prefer complete, working changes over a list of manual instructions

Avoid unnecessarily large refactors while implementing a focused feature.