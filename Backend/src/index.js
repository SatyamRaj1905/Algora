const express = require("express");
const app = express();
require("dotenv").config();
const main = require("./config/db");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRouter = require("./routes/user-Authentication");

app.use(express.json());
app.use(cookieParser());

main().then(async () => {
    app.listen(process.env.PORT, () => {
        console.log("Server listening at port number: " + process.env.PORT);
    });
})
.catch(err => console.log("Error occured" + err)) 

app.use('/user', authRouter)
