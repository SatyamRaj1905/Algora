const express = require('express');
const authRouter =  express.Router();
const {register, login,logout, adminRegister} = require('../controllers/userAuthent')
const userMiddleware = require("../middlewares/usermiddleware");
const adminMiddleware = require("../middlewares/adminMiddleware")

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/logout', userMiddleware,  logout);
authRouter.post('/admin/register', adminMiddleware, adminRegister);


module.exports = authRouter;
