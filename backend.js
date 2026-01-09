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

// ================== 足迹点 (Travel Points) 接口 ==================

// 查询所有点 (支持按 owner 筛选)
async function handleGetTravelPoints(req, res) {
    try {
        // 解析 URL 参数
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const ownerFilter = urlParams.get('owner');

        let query = `
            SELECT 
                gid,
                province,
                name,
                info,
                owner,
                to_char(created_at, 'YYYY-MM-DD HH24:MI') as time,
                ST_X(geom) AS lon,
                ST_Y(geom) AS lat 
            FROM travelpoint
        `;
        
        let params = [];
        if (ownerFilter) {
            query += ` WHERE owner = $1`;
            params.push(ownerFilter);
        }
        
        query += ` ORDER BY created_at DESC`; // 按时间倒序

        const result = await pool.query(query, params);
        res.end(JSON.stringify(result.rows));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// 文本模糊搜索
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

// 添加点
async function handlePostTravelPoints(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
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

// 修改点
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

// 删除点
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

// 拉框空间查询
async function handleBBoxQuery(req, res) {
    try {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const minLon = urlParams.get('minLon');
        const minLat = urlParams.get('minLat');
        const maxLon = urlParams.get('maxLon');
        const maxLat = urlParams.get('maxLat');

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

// ================== 路线 (Routes) 接口 ==================

async function handleGetTravelRoutes(req, res) {
    try {
        const result = await pool.query(`SELECT gid, start, "end", ST_AsGeoJSON(geom) AS geom FROM travelroute1`);
        res.end(JSON.stringify(result.rows));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

async function handlePostTravelRoute(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { start, end, lon1, lat1, lon2, lat2 } = JSON.parse(body);
            const query = `
                INSERT INTO travelroute1 (start, "end", geom)
                VALUES ($1, $2, ST_SetSRID(ST_MakeLine(ST_MakePoint($3, $4), ST_MakePoint($5, $6)), 4326))
                RETURNING *`;
            const result = await pool.query(query, [start, end, lon1, lat1, lon2, lat2]);
            res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

async function handleDeleteTravelRoute(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { gid } = JSON.parse(body);
            await pool.query('DELETE FROM travelroute1 WHERE gid = $1', [gid]);
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

// ================== 成员管理 (Members) 接口 ==================

// 获取所有成员
async function handleGetMembers(req, res) {
    try {
        const result = await pool.query('SELECT * FROM team_members ORDER BY id ASC');
        res.end(JSON.stringify(result.rows));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// 添加新成员
async function handleAddMember(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { name, role, avatar, page_link } = JSON.parse(body);
            const query = `INSERT INTO team_members (name, role, avatar, page_link) VALUES ($1, $2, $3, $4) RETURNING *`;
            const result = await pool.query(query, [name, role, avatar, page_link]);
            res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}

// 删除成员
async function handleDeleteMember(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { id } = JSON.parse(body);
            await pool.query('DELETE FROM team_members WHERE id = $1', [id]);
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
}


// ================== 服务器主程序 ==================

const server = http.createServer(async (req, res) => {
    // 设置 CORS 头
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
        // --- 足迹路由 ---
        if (req.method === 'GET' && req.url.startsWith('/searchtravelpoints')) {
            if (req.url.includes('name=')) {
                const searchName = decodeURIComponent(req.url.split('name=')[1]);
                await handleSearchTravelPoints(req, res, searchName);
            } else {
                await handleGetTravelPoints(req, res);
            }
        }
        else if (req.method === 'POST' && req.url === '/addtravelpoints') { await handlePostTravelPoints(req, res); }
        else if (req.method === 'PUT' && req.url === '/updatetravelpoint') { await handlePutTravelPoints(req, res); }
        else if (req.method === 'DELETE' && req.url === '/deletetravelpoint') { await handleDeleteTravelPoint(req, res); }
        else if (req.method === 'GET' && req.url.startsWith('/query-bbox')) { await handleBBoxQuery(req, res); }

        // --- 路线路由 ---
        else if (req.url === '/gettravelroutes') { await handleGetTravelRoutes(req, res); }
        else if (req.method === 'POST' && req.url === '/addtravelroute') { await handlePostTravelRoute(req, res); }
        else if (req.method === 'DELETE' && req.url === '/deletetravelroute') { await handleDeleteTravelRoute(req, res); }

        // --- 成员管理路由 ---
        else if (req.method === 'GET' && req.url === '/members') { await handleGetMembers(req, res); }
        else if (req.method === 'POST' && req.url === '/addmember') { await handleAddMember(req, res); }
        else if (req.method === 'DELETE' && req.url === '/deletemember') { await handleDeleteMember(req, res); }

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

// 监听端口
const PORT = process.env.PORT || 8082;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`)
})

// 关闭连接池
process.on('SIGTERM', () => pool.end())
process.on('SIGINT', () => pool.end())
