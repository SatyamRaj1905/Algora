const Problem = require("../models/problem");
const Submission = require("../models/submission");
const User = require("../models/user");
const {
    CodeExecutionError,
    executeCode,
    normalizeLanguage,
} = require("../utils/codeExecutor");

const editableProblemFields = [
    "title",
    "description",
    "difficulty",
    "tags",
    "visibleTestCases",
    "hiddenTestCases",
    "startCode",
    "referenceSolution",
];

const pickProblemFields = (requestBody) => {
    const problemData = {};

    for (const field of editableProblemFields) {
        if (Object.prototype.hasOwnProperty.call(requestBody, field)) {
            problemData[field] = requestBody[field];
        }
    }

    return problemData;
};

const toTestCases = (visibleTestCases = [], hiddenTestCases = []) => [
    ...visibleTestCases,
    ...hiddenTestCases,
].map((testCase) => ({
    input: testCase.input,
    output: testCase.output,
}));

// Before an admin saves a problem, every reference solution must pass every case.
const validateReferenceSolutions = async (problemData) => {
    const referenceSolutions = problemData.referenceSolution || [];

    if (!Array.isArray(referenceSolutions)) {
        const error = new Error("referenceSolution must be an array.");
        error.statusCode = 400;
        throw error;
    }

    if (
        !Array.isArray(problemData.visibleTestCases || [])
        || !Array.isArray(problemData.hiddenTestCases || [])
    ) {
        const error = new Error("visibleTestCases and hiddenTestCases must be arrays.");
        error.statusCode = 400;
        throw error;
    }

    const testCases = toTestCases(
        problemData.visibleTestCases,
        problemData.hiddenTestCases,
    );

    if (referenceSolutions.length === 0) {
        const error = new Error("At least one reference solution is required.");
        error.statusCode = 400;
        throw error;
    }

    if (testCases.length === 0) {
        const error = new Error("At least one visible or hidden test case is required.");
        error.statusCode = 400;
        throw error;
    }

    for (const solution of referenceSolutions) {
        const language = normalizeLanguage(solution.language);
        const execution = await executeCode({
            code: solution.completeCode,
            language,
            testCases,
        });
        const failedResult = execution.results.find((result) => !result.passed);

        if (failedResult || execution.testCasesPassed !== testCases.length) {
            const error = new Error(
                `The ${language} reference solution failed test case ${failedResult?.testCase || 1}.`,
            );
            error.statusCode = 400;
            error.details = failedResult?.errorMessage
                || `Expected "${failedResult?.expectedOutput}", but received "${failedResult?.actualOutput}".`;
            throw error;
        }
    }
};

const sendControllerError = (res, error, defaultStatus = 500) => {
    const statusCode = error.statusCode
        || (error.type === "compiler_not_found" ? 503 : null)
        || (error instanceof CodeExecutionError ? 400 : null)
        || (["CastError", "ValidationError"].includes(error.name) ? 400 : null)
        || defaultStatus;

    return res.status(statusCode).json({
        message: error.message,
        errorType: error.type || "request_error",
        ...(error.details ? { details: error.details } : {}),
    });
};

const createProblem = async (req, res) => {
    try {
        const problemData = pickProblemFields(req.body || {});

        await validateReferenceSolutions(problemData);

        // problemCreator always comes from the logged-in admin, never from the body.
        const problem = await Problem.create({
            ...problemData,
            problemCreator: req.result._id,
        });

        return res.status(201).json({
            message: "Problem saved successfully.",
            problem,
        });
    } catch (error) {
        return sendControllerError(res, error, 400);
    }
};

const updateProblem = async (req, res) => {
    try {
        const { id } = req.params;
        const problem = await Problem.findById(id);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found." });
        }

        const changes = pickProblemFields(req.body || {});
        const judgeFields = ["visibleTestCases", "hiddenTestCases", "referenceSolution"];
        const judgeDataChanged = judgeFields.some((field) =>
            Object.prototype.hasOwnProperty.call(changes, field));

        if (judgeDataChanged) {
            await validateReferenceSolutions({
                visibleTestCases: changes.visibleTestCases ?? problem.visibleTestCases,
                hiddenTestCases: changes.hiddenTestCases ?? problem.hiddenTestCases,
                referenceSolution: changes.referenceSolution ?? problem.referenceSolution,
            });
        }

        Object.assign(problem, changes);
        await problem.save();

        return res.status(200).json({
            message: "Problem updated successfully.",
            problem,
        });
    } catch (error) {
        return sendControllerError(res, error);
    }
};

const deleteProblem = async (req, res) => {
    try {
        const { id } = req.params;
        const problem = await Problem.findByIdAndDelete(id);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found." });
        }

        // Remove records that would otherwise point to a deleted problem.
        await Promise.all([
            Submission.deleteMany({ problemId: id }),
            User.updateMany({}, { $pull: { problemSolved: id } }),
        ]);

        return res.status(200).json({ message: "Problem deleted successfully." });
    } catch (error) {
        return sendControllerError(res, error);
    }
};

const getProblemById = async (req, res) => {
    try {
        const problem = await Problem.findById(req.params.id)
            .select("_id title description difficulty tags visibleTestCases startCode");

        if (!problem) {
            return res.status(404).json({ message: "Problem not found." });
        }

        // Hidden cases and reference solutions must never be sent to a contestant.
        return res.status(200).json(problem);
    } catch (error) {
        return sendControllerError(res, error);
    }
};

const getAllProblem = async (req, res) => {
    try {
        const problems = await Problem.find({})
            .select("_id title difficulty tags")
            .sort({ _id: -1 });

        return res.status(200).json(problems);
    } catch (error) {
        return sendControllerError(res, error);
    }
};

const solvedAllProblembyUser = async (req, res) => {
    try {
        const user = await User.findById(req.result._id).populate({
            path: "problemSolved",
            select: "_id title difficulty tags",
        });

        return res.status(200).json(user.problemSolved);
    } catch (error) {
        return sendControllerError(res, error);
    }
};

const submittedProblem = async (req, res) => {
    try {
        const submissions = await Submission.find({
            userId: req.result._id,
            problemId: req.params.pid,
        }).sort({ createdAt: -1 });

        return res.status(200).json({
            message: submissions.length > 0
                ? "Submissions found."
                : "No submissions found for this problem.",
            submissions,
        });
    } catch (error) {
        return sendControllerError(res, error);
    }
};

module.exports = {
    createProblem,
    updateProblem,
    deleteProblem,
    getProblemById,
    getAllProblem,
    solvedAllProblembyUser,
    submittedProblem,
};
