const express = require('express');

const problemRouter =  express.Router();
const adminMiddleware = require("../middlewares/adminMiddleware");
const {createProblem,updateProblem,deleteProblem,getProblemById,getAllProblem,solvedAllProblembyUser,submittedProblem} = require("../controllers/userProblem");
const userMiddleware = require("../middlewares/usermiddleware");


// Create, Update and Delete 
problemRouter.post("/create",adminMiddleware ,createProblem);
problemRouter.put("/update/:id",adminMiddleware, updateProblem);
problemRouter.delete("/delete/:id",adminMiddleware, deleteProblem);

// Read
problemRouter.get("/problemById/:id",userMiddleware,getProblemById);
problemRouter.get("/getAllProblem",userMiddleware, getAllProblem);
problemRouter.get("/problemSolvedByUser",userMiddleware, solvedAllProblembyUser);
problemRouter.get("/submittedProblem/:pid",userMiddleware,submittedProblem);


module.exports = problemRouter;