const { Pool } = require('pg')
const http = require('http')

// 配置数据库连接池
// Render 会自动读取环境变量 DATABASE_URL
// 必须配置 ssl: { rejectUnauthorized: false } 才能连接 Supabase
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
})

// 处理GET请求（查询地点）
async function handleGetTravelPoints(req, res) {
    try {
        const result = await pool.query(`
            SELECT 
                gid,
                province,
                name,
                info,
                owner,
                ST_X(geom) AS lon,
                ST_Y(geom) AS lat 
            FROM travelpoint
        `);
        res.end(JSON.stringify(result.rows));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// 处理POST请求（添加地点）
async function handlePostTravelPoints(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            // 接收 owner 字段
            const { lat, lon, province, name, info, owner } = JSON.parse(body);
            const query = `
                INSERT INTO travelpoint (province, name, info, owner, geom)
                VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))
                RETURNING *`;
            const result = await pool.query(query, [province, name, info, owner, lon, lat]);
            res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

// 处理文本搜索请求
async function handleSearchTravelPoints(req, res, searchName) {
    try {
        const result = await pool.query(`
            SELECT 
                province,
                name,
                info,
                owner,
                ST_X(geom) AS lon,
                ST_Y(geom) AS lat
            FROM travelpoint
            WHERE name ILIKE $1
        `, [`%${searchName}%`]);
        res.end(JSON.stringify(result.rows));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// 处理PUT请求（修改地点）
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

// 处理删除请求
async function handleDeleteTravelPoint(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { gid } = JSON.parse(body);
            await pool.query('DELETE FROM travelpoint WHERE gid = $1', [gid]);
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

// 【新增】处理拉框空间查询 (Bounding Box Query)
async function handleBBoxQuery(req, res) {
    try {
        // 解析URL参数
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const minLon = urlParams.get('minLon');
        const minLat = urlParams.get('minLat');
        const maxLon = urlParams.get('maxLon');
        const maxLat = urlParams.get('maxLat');

        if (!minLon || !minLat || !maxLon || !maxLat) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing coordinates" }));
            return;
        }

        // 使用 PostGIS 函数 ST_MakeEnvelope 构建矩形，ST_Within 判断包含关系
        const query = `
            SELECT 
                gid, province, name, info, owner,
                ST_X(geom) as lon, 
                ST_Y(geom) as lat 
            FROM travelpoint 
            WHERE ST_Within(
                geom, 
                ST_MakeEnvelope($1, $2, $3, $4, 4326)
            )
        `;
        const result = await pool.query(query, [minLon, minLat, maxLon, maxLat]);
        res.end(JSON.stringify(result.rows));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// 创建服务器
const server = http.createServer(async (req, res) => {
    // 设置 CORS 头，允许跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    try {
        // 路由分发
        if (req.method === 'GET' && req.url.startsWith('/searchtravelpoints')) {
            if (req.url.includes('name=')) {
                const searchName = decodeURIComponent(req.url.split('name=')[1]);
                await handleSearchTravelPoints(req, res, searchName);
            } else {
                await handleGetTravelPoints(req, res);
            }
        }
        else if (req.method === 'GET' && req.url.startsWith('/query-bbox')) {
            // 新增的空间查询路由
            await handleBBoxQuery(req, res);
        }
        else if (req.method === 'POST' && req.url === '/addtravelpoints') {
            await handlePostTravelPoints(req, res);
        }
        else if (req.method === 'DELETE' && req.url === '/deletetravelpoint') {
            await handleDeleteTravelPoint(req, res);
        }
        else if (req.method === 'PUT' && req.url === '/updatetravelpoint') {
            await handlePutTravelPoints(req, res);
        }
        else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: '未找到路由' }));
        }
    } catch (err) {
        console.error(err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
});

// 动态监听端口 (Render 需要)
const PORT = process.env.PORT || 8082;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`)
})

// 关闭连接池
process.on('SIGTERM', () => pool.end())
process.on('SIGINT', () => pool.end())
