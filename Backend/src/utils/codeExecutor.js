const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const DEFAULT_LANGUAGE = "c++";
const COMPILE_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB
const MAX_CODE_BYTES = 100 * 1024; // 100 KB

class CodeExecutionError extends Error {
    constructor(message, type, details = "") {
        super(message);
        this.name = "CodeExecutionError";
        this.type = type;
        this.details = details;
    }
}

// The frontend may send "cpp" or "js". The database stores one consistent name.
const normalizeLanguage = (language = DEFAULT_LANGUAGE) => {
    const normalizedLanguage = String(language).trim().toLowerCase();

    const languageAliases = {
        "c++": "c++",
        cpp: "c++",
        cxx: "c++",
        javascript: "javascript",
        js: "javascript",
        node: "javascript",
        java: "java",
    };

    const selectedLanguage = languageAliases[normalizedLanguage];

    if (!selectedLanguage) {
        throw new CodeExecutionError(
            `Unsupported language: ${language}. Use c++, javascript, or java.`,
            "unsupported_language",
        );
    }

    return selectedLanguage;
};

const validateCode = (code) => {
    if (typeof code !== "string" || code.trim().length === 0) {
        throw new CodeExecutionError("Code is required.", "invalid_code");
    }

    if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
        throw new CodeExecutionError(
            `Code is too large. The maximum size is ${MAX_CODE_BYTES / 1024} KB.`,
            "invalid_code",
        );
    }
};

// Judges normally ignore different line endings and spaces at line endings.
const normalizeOutput = (output) => String(output ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

const stopProcess = (childProcess) => {
    if (!childProcess.killed) {
        childProcess.kill("SIGKILL");
    }
};

// spawn() is used without a shell so code/input cannot become a shell command.
const runProcess = (command, args, options = {}) => new Promise((resolve, reject) => {
    const {
        cwd,
        input = "",
        timeoutMs = RUN_TIMEOUT_MS,
    } = options;

    const startedAt = process.hrtime.bigint();
    let stdout = "";
    let stderr = "";
    let completed = false;
    let timedOut = false;
    let outputLimitExceeded = false;

    const childProcess = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
    });

    const finishWithError = (error) => {
        if (completed) {
            return;
        }

        completed = true;
        clearTimeout(timer);
        reject(error);
    };

    const timer = setTimeout(() => {
        timedOut = true;
        stopProcess(childProcess);
    }, timeoutMs);

    childProcess.on("error", (error) => {
        if (error.code === "ENOENT") {
            finishWithError(new CodeExecutionError(
                `Required program "${command}" is not installed or is not available in PATH.`,
                "compiler_not_found",
            ));
            return;
        }

        finishWithError(new CodeExecutionError(error.message, "process_error"));
    });

    const collectOutput = (chunk, streamName) => {
        if (outputLimitExceeded) {
            return;
        }

        if (streamName === "stdout") {
            stdout += chunk.toString();
        } else {
            stderr += chunk.toString();
        }

        if (Buffer.byteLength(stdout + stderr, "utf8") > MAX_OUTPUT_BYTES) {
            outputLimitExceeded = true;
            stopProcess(childProcess);
        }
    };

    childProcess.stdout.on("data", (chunk) => collectOutput(chunk, "stdout"));
    childProcess.stderr.on("data", (chunk) => collectOutput(chunk, "stderr"));

    childProcess.on("close", (exitCode, signal) => {
        if (completed) {
            return;
        }

        completed = true;
        clearTimeout(timer);

        const runtime = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        resolve({
            exitCode,
            signal,
            stdout,
            stderr,
            runtime: Math.round(runtime),
            timedOut,
            outputLimitExceeded,
        });
    });

    childProcess.stdin.on("error", () => {
        // The program may finish before reading stdin. That is not a judge error.
    });
    childProcess.stdin.end(String(input ?? ""));
});

const getJavaClassName = (code) => {
    if (/^\s*package\s+[\w.]+\s*;/m.test(code)) {
        throw new CodeExecutionError(
            "Java package declarations are not supported. Remove the package line.",
            "invalid_code",
        );
    }

    const publicClass = code.match(
        /\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    );
    const firstClass = code.match(/\bclass\s+([A-Za-z_$][\w$]*)/);

    return publicClass?.[1] || firstClass?.[1] || "Main";
};

const prepareProgram = async (temporaryDirectory, code, language) => {
    if (language === "c++") {
        const sourcePath = path.join(temporaryDirectory, "Main.cpp");
        const executableName = process.platform === "win32" ? "program.exe" : "program.out";
        const executablePath = path.join(temporaryDirectory, executableName);

        await fs.writeFile(sourcePath, code, "utf8");

        return {
            compileCommand: process.env.CPP_COMPILER || "g++",
            compileArgs: [sourcePath, "-std=c++17", "-O2", "-o", executablePath],
            runCommand: executablePath,
            runArgs: [],
        };
    }

    if (language === "javascript") {
        const sourcePath = path.join(temporaryDirectory, "Main.js");
        await fs.writeFile(sourcePath, code, "utf8");

        return {
            compileCommand: null,
            compileArgs: [],
            runCommand: process.execPath,
            runArgs: [sourcePath],
        };
    }

    const className = getJavaClassName(code);
    const sourcePath = path.join(temporaryDirectory, `${className}.java`);

    await fs.writeFile(sourcePath, code, "utf8");

    return {
        compileCommand: process.env.JAVA_COMPILER || "javac",
        compileArgs: [sourcePath],
        runCommand: process.env.JAVA_RUNTIME || "java",
        runArgs: ["-cp", temporaryDirectory, className],
    };
};

const compileProgram = async (program, temporaryDirectory) => {
    if (!program.compileCommand) {
        return 0;
    }

    const compileResult = await runProcess(
        program.compileCommand,
        program.compileArgs,
        { cwd: temporaryDirectory, timeoutMs: COMPILE_TIMEOUT_MS },
    );

    if (compileResult.timedOut) {
        throw new CodeExecutionError(
            "Compilation took too long.",
            "compilation_timeout",
            compileResult.stderr,
        );
    }

    if (compileResult.outputLimitExceeded) {
        throw new CodeExecutionError(
            "Compiler output exceeded the 1 MB limit.",
            "output_limit",
        );
    }

    if (compileResult.exitCode !== 0) {
        const compilerMessage = compileResult.stderr || compileResult.stdout;
        const installedLauncherCannotFindCompiler = [
            /unable to locate a java runtime/i,
            /no java runtime present/i,
            /invalid active developer path/i,
            /is not recognized as an internal or external command/i,
        ].some((pattern) => pattern.test(compilerMessage));

        if (installedLauncherCannotFindCompiler) {
            throw new CodeExecutionError(
                `Required program "${program.compileCommand}" is not fully installed or configured.`,
                "compiler_not_found",
                compilerMessage,
            );
        }

        throw new CodeExecutionError(
            "Compilation failed.",
            "compilation_error",
            compilerMessage,
        );
    }

    return compileResult.runtime;
};

const runTestCase = async (program, temporaryDirectory, testCase, index) => {
    const processResult = await runProcess(program.runCommand, program.runArgs, {
        cwd: temporaryDirectory,
        input: testCase.input,
        timeoutMs: RUN_TIMEOUT_MS,
    });

    let errorType = "";
    let errorMessage = "";

    if (processResult.timedOut) {
        errorType = "time_limit_exceeded";
        errorMessage = `Test case ${index + 1} exceeded the ${RUN_TIMEOUT_MS} ms time limit.`;
    } else if (processResult.outputLimitExceeded) {
        errorType = "output_limit_exceeded";
        errorMessage = "Program output exceeded the 1 MB limit.";
    } else if (processResult.exitCode !== 0) {
        errorType = "runtime_error";
        errorMessage = processResult.stderr || `Program stopped with exit code ${processResult.exitCode}.`;
    }

    const hasExpectedOutput = Object.prototype.hasOwnProperty.call(testCase, "output");
    const passed = errorType
        ? false
        : hasExpectedOutput
            ? normalizeOutput(processResult.stdout) === normalizeOutput(testCase.output)
            : null;

    return {
        testCase: index + 1,
        input: String(testCase.input ?? ""),
        expectedOutput: hasExpectedOutput ? String(testCase.output ?? "") : null,
        actualOutput: processResult.stdout,
        passed,
        runtime: processResult.runtime,
        errorType,
        errorMessage,
    };
};

const executeCode = async ({ code, language = DEFAULT_LANGUAGE, testCases = [] }) => {
    validateCode(code);
    const selectedLanguage = normalizeLanguage(language);

    if (!Array.isArray(testCases)) {
        throw new CodeExecutionError("testCases must be an array.", "invalid_test_cases");
    }

    // mkdtemp safely creates a unique directory, so an extra uuid package is not needed.
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "algora-code-"));

    try {
        const program = await prepareProgram(temporaryDirectory, code, selectedLanguage);
        const compilationTime = await compileProgram(program, temporaryDirectory);
        const casesToRun = testCases.length > 0 ? testCases : [{ input: "" }];
        const results = [];

        for (let index = 0; index < casesToRun.length; index += 1) {
            const result = await runTestCase(
                program,
                temporaryDirectory,
                casesToRun[index],
                index,
            );

            results.push(result);

            // There is no reason to run more cases after a program-level error.
            if (result.errorType) {
                break;
            }
        }

        const checkedResults = results.filter((result) => result.passed !== null);

        return {
            language: selectedLanguage,
            compilationTime,
            runtime: results.reduce((total, result) => total + result.runtime, 0),
            testCasesPassed: checkedResults.filter((result) => result.passed).length,
            testCasesTotal: testCases.length,
            results,
        };
    } finally {
        // Source files and compiled .out/.exe/.class files are removed immediately.
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
};

module.exports = {
    CodeExecutionError,
    DEFAULT_LANGUAGE,
    executeCode,
    normalizeLanguage,
};
