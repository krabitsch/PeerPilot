from pathlib import Path
import shutil

path = Path("src/api/src/modules/eval/service.js")
backup = path.with_suffix(".js.bak-passkey")

text = path.read_text()

if not backup.exists():
    shutil.copy2(path, backup)


def replace_section(
    source: str,
    start_marker: str,
    end_marker: str,
    replacement: str
) -> str:

    start = source.find(start_marker)

    if start == -1:
        raise RuntimeError(
            f"Could not find start marker: {start_marker}"
        )

    end = source.find(
        end_marker,
        start
    )

    if end == -1:
        raise RuntimeError(
            f"Could not find end marker: {end_marker}"
        )

    return (
        source[:start]
        + replacement.rstrip()
        + "\n\n"
        + source[end:]
    )


# ============================================================
# 1. Add crypto import
# ============================================================

if "const crypto = require('crypto')" not in text:

    text = text.replace(
        "const { prisma } = require('@transcendence/database')\n",

        "const { prisma } = require('@transcendence/database')\n"
        "const crypto = require('crypto')\n",

        1
    )


# ============================================================
# 2. getEvalAssignments()
# ============================================================

text = replace_section(
    text,

    "const getEvalAssignments = async (assignmentId)=>{",

    "// delete all EvalAssignments for one particular assignment.id",

    """const getEvalAssignments = async (assignmentId)=>{
  const assignmentIdInt = parseInt(assignmentId)

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentIdInt }
  })

  if (!assignment)
    throw new NotFoundError('Assignment not found')

  const select = {
    id: true,
    assignmentId: true,
    evalueeGroupId: true,
    evaluatorGroupId: true,
    evaluatorUserId: true,
    round: true,
    status: true,
    submissionId: true,
    evalResponseId: true,
    createdAt: true,
    passKey: true,

    evaluatorUser: {
      select: {
        id: true,
        username: true
      }
    }
  }

  return await utils.getEvalAssignments(
    assignmentIdInt,
    select
  )
}"""
)


# ============================================================
# 3. getEvalAssignmentById() + passkey helper
# ============================================================

text = replace_section(
    text,

    "const getEvalAssignmentById = async (evalAssignmentId) => {",

    "const createEvalAssignment = async ({assignmentId, evalueeGroupId, evaluatorGroupId, evaluatorUserId, round}) => {",

    """const getEvalAssignmentById = async (evalAssignmentId) => {
  const evalAssignmentIdInt =
    parseInt(evalAssignmentId)

  const select = {
    id: true,
    assignmentId: true,
    evalueeGroupId: true,
    evaluatorGroupId: true,
    evaluatorUserId: true,
    round: true,
    status: true,
    submissionId: true,
    evalResponseId: true,
    createdAt: true,
    passKey: true,

    evaluatorUser: {
      select: {
        id: true,
        username: true
      }
    }
  }

  const result =
    await utils.getEvalAssignmentById(
      evalAssignmentIdInt,
      select
    )

  if (!result)
    throw new NotFoundError(
      'Eval assignment not found'
    )

  return result
}


const generateUniqueEvalPassKey = async () => {

  for (
    let attempt = 0;
    attempt < 20;
    attempt++
  ) {

    const passKey =
      String(
        crypto.randomInt(
          100000,
          1000000
        )
      )

    const existing =
      await prisma.evalAssignment.findFirst({
        where: {
          passKey
        },

        select: {
          id: true
        }
      })

    if (!existing)
      return passKey
  }

  throw new ConflictError(
    'Could not generate a unique evaluation passkey'
  )
}"""
)


# ============================================================
# 4. createEvalAssignment()
# ============================================================

text = replace_section(
    text,

    "const createEvalAssignment = async ({assignmentId, evalueeGroupId, evaluatorGroupId, evaluatorUserId, round}) => {",

    "const updateEvalAssignment = async (evalAssignmentId, { assignmentId, evalueeGroupId, evaluatorUserId, evaluatorGroupId,",

    """const createEvalAssignment = async ({
  assignmentId,
  evalueeGroupId,
  evaluatorGroupId,
  evaluatorUserId,
  round
}) => {

  const assignmentIdInt =
    parseInt(assignmentId)

  const evalueeGroupIdInt =
    parseInt(evalueeGroupId)

  const evaluatorGroupIdInt =
    parseInt(evaluatorGroupId)

  const evaluatorUserIdInt =
    parseInt(evaluatorUserId)

  const roundInt =
    parseInt(round)


  if (
    !assignmentIdInt ||
    !evalueeGroupIdInt ||
    !evaluatorGroupIdInt ||
    !evaluatorUserIdInt ||
    !roundInt
  ) {
    throw new ValidationError(
      'assignmentId, evalueeGroupId, evaluatorGroupId, evaluatorUserId and round are required'
    )
  }


  const assignment =
    await prisma.assignment.findUnique({
      where: {
        id:
          assignmentIdInt
      }
    })


  if (!assignment)
    throw new NotFoundError(
      'Assignment not found'
    )


  const evalueeGroup =
    await prisma.group.findUnique({
      where: {
        id:
          evalueeGroupIdInt
      }
    })


  if (!evalueeGroup)
    throw new NotFoundError(
      'Evaluee group not found'
    )


  if (
    evalueeGroup.assId !==
    assignmentIdInt
  ) {
    throw new ValidationError(
      'Evaluee group does not belong to this assignment'
    )
  }


  const evaluatorGroup =
    await prisma.group.findUnique({
      where: {
        id:
          evaluatorGroupIdInt
      }
    })


  if (!evaluatorGroup)
    throw new NotFoundError(
      'Evaluator group not found'
    )


  if (
    evaluatorGroup.assId !==
    assignmentIdInt
  ) {
    throw new ValidationError(
      'Evaluator group does not belong to this assignment'
    )
  }


  if (
    evaluatorGroupIdInt ===
    evalueeGroupIdInt
  ) {
    throw new ValidationError(
      'Evaluator group cannot evaluate itself'
    )
  }


  const memberEvaluatorGroup =
    await prisma.groupMember.findUnique({

      where: {
        userId_groupId: {

          userId:
            evaluatorUserIdInt,

          groupId:
            evaluatorGroupIdInt
        }
      }

    })


  if (!memberEvaluatorGroup) {
    throw new ValidationError(
      'Evaluator user is not a member of evaluator group'
    )
  }


  const existingEvalAssignment =
    await prisma.evalAssignment.findUnique({

      where: {
        assignmentId_evalueeGroupId_evaluatorUserId_round: {

          assignmentId:
            assignmentIdInt,

          evalueeGroupId:
            evalueeGroupIdInt,

          evaluatorUserId:
            evaluatorUserIdInt,

          round:
            roundInt
        }
      }

    })


  if (existingEvalAssignment) {
    throw new ConflictError(
      'Eval assignment already exists'
    )
  }


  const passKey =
    await generateUniqueEvalPassKey()


  return await prisma.evalAssignment.create({

    data: {

      assignmentId:
        assignmentIdInt,

      evalueeGroupId:
        evalueeGroupIdInt,

      evaluatorGroupId:
        evaluatorGroupIdInt,

      evaluatorUserId:
        evaluatorUserIdInt,

      round:
        roundInt,

      passKey
    },


    select: {

      id: true,

      assignmentId: true,

      evalueeGroupId: true,

      evaluatorGroupId: true,

      evaluatorUserId: true,

      round: true,

      status: true,

      createdAt: true,

      passKey: true,


      evaluatorUser: {

        select: {
          id: true,
          username: true
        }

      }

    }

  })
}"""
)


# ============================================================
# 5. updateEvalAssignment()
# ============================================================

text = replace_section(
    text,

    "const updateEvalAssignment = async (evalAssignmentId, { assignmentId, evalueeGroupId, evaluatorUserId, evaluatorGroupId,",

    "const deleteEvalAssignment = async (evalAssignmentId) => {",

    """const updateEvalAssignment = async (evalAssignmentId, {
  assignmentId,
  evalueeGroupId,
  evaluatorUserId,
  evaluatorGroupId,
  round,
  status,
  submissionId,
  evalResponseId
}) => {

  const evalAssignmentIdInt =
    parseInt(evalAssignmentId)

  const assignmentIdInt =
    parseInt(assignmentId)

  const evalueeGroupIdInt =
    parseInt(evalueeGroupId)

  const evaluatorUserIdInt =
    parseInt(evaluatorUserId)

  const evaluatorGroupIdInt =
    parseInt(evaluatorGroupId)

  const roundInt =
    parseInt(round)

  const submissionIdInt =
    submissionId
      ? parseInt(submissionId)
      : null

  const evalResponseIdInt =
    evalResponseId
      ? parseInt(evalResponseId)
      : null


  if (
    !evalAssignmentIdInt ||
    !assignmentIdInt ||
    !evalueeGroupIdInt ||
    !evaluatorGroupIdInt ||
    !evaluatorUserIdInt ||
    !roundInt ||
    !status
  ) {
    throw new ValidationError(
      'evalAssignmentId, assignmentId, evalueeGroupId, evaluatorGroupId, evaluatorUserId and round are required'
    )
  }


  const targetEvalAssign =
    await utils.getEvalAssignmentById(
      evalAssignmentIdInt
    )


  if (!targetEvalAssign)
    throw new NotFoundError(
      'Evaluation assignment not found'
    )


  const assignment =
    await prisma.assignment.findUnique({
      where: {
        id:
          assignmentIdInt
      }
    })


  if (!assignment)
    throw new NotFoundError(
      'Assignment not found'
    )


  const evalueeGroup =
    await prisma.group.findUnique({
      where: {
        id:
          evalueeGroupIdInt
      }
    })


  if (!evalueeGroup)
    throw new NotFoundError(
      'Evaluee group not found'
    )


  if (
    evalueeGroup.assId !==
    assignmentIdInt
  ) {
    throw new ValidationError(
      'Evaluee group does not belong to this assignment'
    )
  }


  const evaluatorGroup =
    await prisma.group.findUnique({
      where: {
        id:
          evaluatorGroupIdInt
      }
    })


  if (!evaluatorGroup)
    throw new NotFoundError(
      'Evaluator group not found'
    )


  if (
    evaluatorGroup.assId !==
    assignmentIdInt
  ) {
    throw new ValidationError(
      'Evaluator group does not belong to this assignment'
    )
  }


  if (
    evaluatorGroupIdInt ===
    evalueeGroupIdInt
  ) {
    throw new ValidationError(
      'Evaluator group cannot evaluate itself'
    )
  }


  const memberEvaluatorGroup =
    await prisma.groupMember.findUnique({

      where: {

        userId_groupId: {

          userId:
            evaluatorUserIdInt,

          groupId:
            evaluatorGroupIdInt
        }

      }

    })


  if (!memberEvaluatorGroup) {
    throw new ValidationError(
      'Evaluator user is not a member of evaluator group'
    )
  }


  const validStatuses = [
    'Pending',
    'Submitted',
    'Cancelled'
  ]


  if (!validStatuses.includes(status)) {
    throw new ValidationError(
      'Invalid status'
    )
  }


  if (
    (
      submissionId &&
      isNaN(submissionIdInt)
    ) ||
    (
      evalResponseId &&
      isNaN(evalResponseIdInt)
    )
  ) {
    throw new ValidationError(
      'Invalid submissionId or evalResponseId'
    )
  }


  if (submissionIdInt !== null) {

    const submission =
      await prisma.submission.findUnique({
        where: {
          id:
            submissionIdInt
        }
      })


    if (!submission)
      throw new NotFoundError(
        'Submission not found'
      )
  }


  if (evalResponseIdInt !== null) {

    const evalResponse =
      await prisma.evalResponse.findUnique({
        where: {
          id:
            evalResponseIdInt
        }
      })


    if (!evalResponse)
      throw new NotFoundError(
        'Eval response not found'
      )
  }


  const existingEvalAssignment =
    await prisma.evalAssignment.findFirst({

      where: {

        assignmentId:
          assignmentIdInt,

        evalueeGroupId:
          evalueeGroupIdInt,

        evaluatorUserId:
          evaluatorUserIdInt,

        round:
          roundInt,

        NOT: {
          id:
            evalAssignmentIdInt
        }

      }

    })


  if (existingEvalAssignment) {
    throw new ConflictError(
      'Eval assignment already exists'
    )
  }


  const result =
    await prisma.evalAssignment.update({

      where: {
        id:
          evalAssignmentIdInt
      },

      data: {

        assignmentId:
          assignmentIdInt,

        evalueeGroupId:
          evalueeGroupIdInt,

        evaluatorUserId:
          evaluatorUserIdInt,

        evaluatorGroupId:
          evaluatorGroupIdInt,

        round:
          roundInt,

        status,

        submissionId:
          submissionIdInt,

        evalResponseId:
          evalResponseIdInt
      },


      select: {

        id: true,

        assignmentId: true,

        evalueeGroupId: true,

        evaluatorUserId: true,

        evaluatorGroupId: true,

        round: true,

        status: true,

        submissionId: true,

        evalResponseId: true,

        createdAt: true,

        passKey: true,


        evaluatorUser: {

          select: {
            id: true,
            username: true
          }

        }

      }

    })


  return result
}"""
)


# ============================================================
# 6. startEvaluation()
# ============================================================

text = replace_section(
    text,

    "const startEvaluation = async",

    "const submitEvaluation = async",

    """const startEvaluation = async ({
  evaluatorUserId,
  leaderEmail,
  passkey
}) => {

  const evaluatorUserIdInt =
    parseInt(evaluatorUserId)

  const cleanPassKey =
    String(
      passkey ?? ''
    ).trim()


  if (
    !evaluatorUserIdInt ||
    !leaderEmail ||
    !cleanPassKey
  ) {
    throw new ValidationError(
      'evaluatorUserId, leaderEmail and passkey are required'
    )
  }


  // The passkey identifies one specific
  // evaluator/evaluee pairing.
  const evalAssignment =
    await prisma.evalAssignment.findUnique({

      where: {
        passKey:
          cleanPassKey
      }

    })


  if (!evalAssignment) {
    throw new NotFoundError(
      'Invalid evaluation passkey'
    )
  }


  if (
    evalAssignment.evaluatorUserId !==
    evaluatorUserIdInt
  ) {
    throw new UnauthorizedError(
      'This evaluation has not been assigned to you'
    )
  }


  if (
    evalAssignment.status !==
    'Pending'
  ) {
    throw new ConflictError(
      'This evaluation is no longer pending'
    )
  }


  // Find the submission belonging to the
  // evaluee group for this pairing.
  const submission =
    await prisma.submission.findFirst({

      where: {
        groupId:
          evalAssignment.evalueeGroupId
      },

      include: {
        group: true,
        file: true
      }

    })


  if (!submission) {
    throw new NotFoundError(
      'Submission not found'
    )
  }


  if (
    submission.status !==
    'Close'
  ) {
    throw new ValidationError(
      'Submission is not closed yet'
    )
  }


  // Keep the group-leader email as an
  // additional verification step.
  const leader =
    await utils.searchUser(
      leaderEmail
    )


  if (!leader) {
    throw new NotFoundError(
      'No user found with that email'
    )
  }


  if (
    submission.group.leaderId !==
    leader.id
  ) {
    throw new ValidationError(
      "That email is not the leader of this submission's group"
    )
  }


  if (
    evalAssignment.submissionId &&
    evalAssignment.submissionId !==
      submission.id
  ) {
    throw new ValidationError(
      'Mismatched submission for this evaluation pairing'
    )
  }


  if (!evalAssignment.submissionId) {

    await prisma.evalAssignment.update({

      where: {
        id:
          evalAssignment.id
      },

      data: {
        submissionId:
          submission.id
      }

    })

  }


  const assignment =
    await getAssignmentWithSheet(
      evalAssignment.assignmentId
    )


  if (!assignment?.evalSheet) {
    throw new NotFoundError(
      'This assignment has no eval sheet yet'
    )
  }


  const file =
    submission.file
      ? {
          ...submission.file,

          url:
            storage.getPublicUrl(
              submission.file.url
            )
        }
      : null


  return {

    evalAssignmentId:
      evalAssignment.id,


    assignment: {

      id:
        assignment.id,

      name:
        assignment.name,

      description:
        assignment.description,

      max_score:
        assignment.max_score

    },


    group: {

      id:
        submission.group.id,

      name:
        submission.group.name

    },


    submission: {

      id:
        submission.id,

      file

    },


    evalSheet:
      assignment.evalSheet

  }
}"""
)


# ============================================================
# Write only after every patch succeeded
# ============================================================

path.write_text(text)

print("")
print("Patch applied successfully.")
print("")
print("Updated:")
print(path)
print("")
print("Backup:")
print(backup)
print("")