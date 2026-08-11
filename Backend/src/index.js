const express = require('express')
const app = express();
require('dotenv').config();
const cors = require('cors')


app.listen(process.env.PORT, ()=>{
    console.log("Server listening at port number: "+ process.env.PORT);
})


