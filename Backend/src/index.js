const express = require("express");
const app = express();
require("dotenv").config();
const main = require("./config/db");
const redisClient = require('./config/redis');
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRouter = require("./routes/user-Authentication");

app.use(express.json());
app.use(cookieParser());


app.use('/user', authRouter)

const InitalizeConnection = async ()=>{
    try{
        await Promise.all([main(),redisClient.connect()]);
        console.log("DB Connected");
        
        app.listen(process.env.PORT, ()=>{
            console.log("Server listening at port number: "+ process.env.PORT);
        })

    }
    catch(err){
        console.log("Error: "+err);
    }
}

InitalizeConnection();
