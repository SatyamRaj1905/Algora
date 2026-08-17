const {createClient} = require('redis');

const redisClient = createClient({
    username: 'default',
    password: process.env.REDIS_PASS,
    socket: {
        host: 'silk-individual-sprout-65836.db.redis.io',
        port: 15058
    }
});

module.exports = redisClient;