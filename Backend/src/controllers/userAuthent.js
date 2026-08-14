const User = require("../models/user");
const validate = require('../utils/validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Register
const register = async (req, res) => {
    try {
        // Data validation through mandatory fields
        validate(req.body);

        const {firstName, emailId, password} = req.body;
        // Password hashing and encrypting
        req.body.password = await bcrypt.hash(password, 10);

        const user = await User.create(req.body);
        const token = jwt.sign({_id:user._id , emailId:emailId, role:'user'},process.env.JWT_KEY,{expiresIn: 60*60});

        const reply = {
            firstName: user.firstName,
            emailId: user.emailId,
            _id: user._id,
            role:user.role,
        }
    
        res.cookie('token',token,{maxAge: 60*60*1000});
        res.status(201).json({
            user:reply,
            message:"Registered Successfully"
        })

    } catch (error) {
        res.status(401).send("Error:" + error);
        
    }
}

// Login 
const login = async (req,res)=>{
    try{
        const {emailId, password} = req.body;

        if(!emailId)
            throw new Error("Invalid Credentials");
        if(!password)
            throw new Error("Invalid Credentials");

        const user = await User.findOne({emailId});

        const match = await bcrypt.compare(password,user.password);

        if(!match)
            throw new Error("Invalid Credentials");

        const reply = {
            firstName: user.firstName,
            emailId: user.emailId,
            _id: user._id,
            role:user.role,
        }

        const token =  jwt.sign({_id:user._id , emailId:emailId, role:user.role},process.env.JWT_KEY,{expiresIn: 60*60});
        res.cookie('token',token,{maxAge: 60*60*1000});
        res.status(201).json({
            user:reply,
            message:"Logged In Successfully"
        })
    }
    catch(err){
        res.status(401).send("Error: "+err);
    }
}

// Logout
const logout = async(req,res)=>{
    try{
        const {token} = req.cookies;
        const payload = jwt.decode(token);

        res.cookie("token",null,{expires: new Date(Date.now())});
        res.send("Logged Out Succesfully");

    }
    catch(error){
       res.status(503).send("Error: "+error);
    }
}

module.exports = {register, login, logout}