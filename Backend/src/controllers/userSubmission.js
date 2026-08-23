const Problem = require("../models/problem");
const Submission = require("../models/submission");
const User = require("../models/user");
const {
    CodeExecutionError,
    DEFAULT_LANGUAGE,
    executeCode,
    normalizeLanguage,
} = require("../utils/codeExecutor");

const getProblem = async (problemId) => Problem.findById(problemId)
    .select("visibleTestCases hiddenTestCases");

const formatExecutionError = (error) => ({
    message: error.message,
    errorType: error.type || "execution_error",
    ...(error.details ? { details: error.details } : {}),
});

const getErrorStatus = (error) => {
    if (error.type === "compiler_not_found") {
        return 503;
    }

    if (["CastError", "ValidationError"].includes(error.name)) {
        return 400;
    }

    return error instanceof CodeExecutionError ? 400 : 500;
};

// POST /submission/run/:id
// Runs custom input when it is supplied; otherwise it checks all visible cases.
const runCode = async (req, res) => {
    const requestBody = req.body || {};

    try {
        const problem = await getProblem(req.params.id);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found." });
        }

        const language = normalizeLanguage(requestBody.language || DEFAULT_LANGUAGE);
        const hasCustomInput = Object.prototype.hasOwnProperty.call(requestBody, "input");
        const testCases = hasCustomInput
            ? [{ input: requestBody.input }]
            : problem.visibleTestCases.map((testCase) => ({
                input: testCase.input,
                output: testCase.output,
            }));

        const execution = await executeCode({
            code: requestBody.code,
            language,
            testCases,
        });

        return res.status(200).json({
            message: "Code ran successfully.",
            mode: hasCustomInput ? "custom-input" : "visible-test-cases",
            ...execution,
        });
    } catch (error) {
        return res.status(getErrorStatus(error)).json(formatExecutionError(error));
    }
};

// POST /submission/submit/:id
// Judges the code, stores the attempt, and updates problemSolved when accepted.
const submitCode = async (req, res) => {
    const requestBody = req.body || {};
    let problem;
    let language;

    try {
        problem = await getProblem(req.params.id);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found." });
        }

        language = normalizeLanguage(requestBody.language || DEFAULT_LANGUAGE);

        const testCases = [
            ...problem.visibleTestCases,
            ...problem.hiddenTestCases,
        ].map((testCase) => ({
            input: testCase.input,
            output: testCase.output,
        }));

        if (testCases.length === 0) {
            return res.status(400).json({
                message: "This problem does not have any test cases yet.",
            });
        }

        const execution = await executeCode({
            code: requestBody.code,
            language,
            testCases,
        });
        const executionError = execution.results.find((result) => result.errorType);
        const accepted = !executionError
            && execution.testCasesPassed === testCases.length;
        const status = executionError
            ? "error"
            : accepted
                ? "accepted"
                : "wrong";

        const submission = await Submission.create({
            userId: req.result._id,
            problemId: problem._id,
            code: requestBody.code,
            language,
            status,
            runtime: execution.runtime,
            memory: 0,
            errorMessage: executionError?.errorMessage || "",
            testCasesPassed: execution.testCasesPassed,
            testCasesTotal: testCases.length,
        });

        if (accepted) {
            await User.findByIdAndUpdate(req.result._id, {
                $addToSet: { problemSolved: problem._id },
            });
        }

        // Hidden input/output and the reference solution are never returned.
        const judgeResults = execution.results.map((result) => ({
            testCase: result.testCase,
            passed: result.passed,
            runtime: result.runtime,
            errorType: result.errorType,
            errorMessage: result.errorMessage,
        }));

        return res.status(201).json({
            message: accepted ? "Solution accepted." : "Solution not accepted.",
            submissionId: submission._id,
            status,
            language,
            runtime: execution.runtime,
            testCasesPassed: execution.testCasesPassed,
            testCasesTotal: testCases.length,
            results: judgeResults,
        });
    } catch (error) {
        // Compilation/runtime configuration errors are also useful submission history.
        if (
            problem
            && language
            && typeof requestBody.code === "string"
            && requestBody.code.trim()
            && error instanceof CodeExecutionError
        ) {
            try {
                const submission = await Submission.create({
                    userId: req.result._id,
                    problemId: problem._id,
                    code: requestBody.code,
                    language,
                    status: "error",
                    errorMessage: error.details || error.message,
                    testCasesPassed: 0,
                    testCasesTotal:
                        problem.visibleTestCases.length + problem.hiddenTestCases.length,
                });

                return res.status(getErrorStatus(error)).json({
                    ...formatExecutionError(error),
                    submissionId: submission._id,
                    status: "error",
                });
            } catch (databaseError) {
                return res.status(500).json({
                    message: "Code execution failed and the submission could not be saved.",
                    errorType: "database_error",
                    details: databaseError.message,
                });
            }
        }

        return res.status(getErrorStatus(error)).json(formatExecutionError(error));
    }
};

module.exports = { runCode, submitCode };
