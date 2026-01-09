const { Pool } = require('pg')
const http = require('http')


const pool = new Pool({
    // 如果本地运行，读取 .env；如果云端运行，读取环境变量
    connectionString: process.env.DATABASE_URL, 
    ssl: {
        rejectUnauthorized: false // 允许连接云数据库
    }
});
// 处理GET请求（查询地点）
async function handleGetTravelPoints(req, res) {
    const result = await pool.query(`
        SELECT 
            gid,
            province,
            name,
            info,
            ST_X(geom) AS lon,
            ST_Y(geom) AS lat 
        FROM travelpoint
    `);
    res.end(JSON.stringify(result.rows));
}

// 处理POST请求（添加地点）
async function handlePostTravelPoints(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        const { lat, lon, province, name, info } = JSON.parse(body);
        const query = `
            INSERT INTO travelpoint (province, name, info, geom)
            VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
            RETURNING *`;
        const result = await pool.query(query, [province, name, info, lon, lat]);
        res.end(JSON.stringify(result.rows[0]));
    });
}

// 处理文本搜索请求
async function handleSearchTravelPoints(req, res, searchName) {
    const result = await pool.query(`
        SELECT 
            province,
            name,
            info,
            ST_X(geom) AS lon,
            ST_Y(geom) AS lat
        FROM travelpoint
        WHERE name ILIKE $1
    `, [`%${searchName}%`]);
    res.end(JSON.stringify(result.rows));
}

// 在backend.js中添加PUT请求处理函数
async function handlePutTravelPoints(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { gid, province, name, info, lat, lon } = JSON.parse(body);
            const query = `
                UPDATE travelpoint 
                SET 
                    province = $1,
                    name = $2,
                    info = $3,
                    geom = ST_SetSRID(ST_MakePoint($4, $5), 4326)
                WHERE gid = $6
                RETURNING *`;
            const result = await pool.query(query, [province, name, info, lon, lat, gid]);
            res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

// 处理GET请求（查询路线）
async function handleGetTravelRoutes(req, res) {
    const result = await pool.query(`
        SELECT 
            gid,
            start,
            "end", 
            ST_AsGeoJSON(geom) AS geom
        FROM travelroute1
    `);
    res.end(JSON.stringify(result.rows));
}

// 处理POST请求（添加路线）
async function handlePostTravelRoute(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { start, end, lon1, lat1, lon2, lat2 } = JSON.parse(body);
            const query = `
                INSERT INTO travelroute1 (start, "end", geom)
                VALUES ($1, $2, ST_SetSRID(ST_MakeLine(
                    ST_MakePoint($3, $4),
                    ST_MakePoint($5, $6)
                ), 4326))
                RETURNING *`;
            const result = await pool.query(query, [start, end, lon1, lat1, lon2, lat2]);
            res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

// 在createServer回调中添加POST路由处理
const server = http.createServer(async (req, res) => {
    // 设置完整的CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS,DELETE,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    try {
        if (req.method === 'GET' && req.url.startsWith('/searchtravelpoints')) {
            if (req.url.includes('name=')) {
                const searchName = decodeURIComponent(req.url.split('name=')[1]);
                await handleSearchTravelPoints(req, res, searchName);
            } else {
                await handleGetTravelPoints(req, res);
            }
        }
        else if (req.url === '/gettravelroutes') {
            await handleGetTravelRoutes(req, res);
        }
        else if (req.method === 'POST' && req.url === '/addtravelpoints') {
            await handlePostTravelPoints(req, res);
        }
        else if (req.method === 'POST' && req.url === '/addtravelroute') {
            await handlePostTravelRoute(req, res);
        }
        else if (req.method === 'DELETE' && req.url === '/deletetravelpoint') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                const { gid } = JSON.parse(body);
                await pool.query('DELETE FROM travelpoint WHERE gid = $1', [gid]);
                res.end(JSON.stringify({ success: true }));
            });
        }
        else if (req.method === 'DELETE' && req.url === '/deletetravelroute') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                const { gid } = JSON.parse(body);
                await pool.query('DELETE FROM travelroute1 WHERE gid = $1', [gid]);
                res.end(JSON.stringify({ success: true }));
            });
        }
        else if (req.method === 'PUT' && req.url === '/updatetravelpoint') {
            await handlePutTravelPoints(req, res);
        }
        else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: '未找到路由' }));
        }
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
});

// 启动服务器
const PORT = process.env.PORT || 8082; // 优先使用云平台分配的端口
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});

// 关闭连接池
process.on('SIGTERM', () => pool.end())
process.on('SIGINT', () => pool.end())