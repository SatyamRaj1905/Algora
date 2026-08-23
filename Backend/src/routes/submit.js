const express = require("express");
const { runCode, submitCode } = require("../controllers/userSubmission");
const userMiddleware = require("../middlewares/usermiddleware");

const submissionRouter = express.Router();

// :id is the MongoDB id of the problem being run or submitted.
submissionRouter.post("/run/:id", userMiddleware, runCode);
submissionRouter.post("/submit/:id", userMiddleware, submitCode);

module.exports = submissionRouter;
