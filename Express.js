const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const redis = require('redis');
const Web3 = require('web3');

// تكوينات التطبيق
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(bodyParser.json());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// تكوين قاعدة البيانات
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// تكوين Redis
const redisClient = redis.createClient({
    url: process.env.REDIS_URL
});
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

// تكوين Web3
const web3 = new Web3(process.env.BLOCKCHAIN_NODE_URL);

// Middleware المصادقة
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.sendStatus(401);
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, phone, referralCode } = req.body;
        
        // التحقق من البيانات
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        // التحقق من عدم وجود مستخدم بنفس البريد
        const userExists = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        // تشفير كلمة المرور
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // إنشاء رمز إحالة فريد
        const referralCodeUser = generateReferralCode(email);
        
        // التحقق من رمز الإحالة إذا وجد
        let referredBy = null;
        if (referralCode) {
            const referrer = await pool.query(
                'SELECT id FROM users WHERE referral_code = $1',
                [referralCode]
            );
            
            if (referrer.rows.length > 0) {
                referredBy = referrer.rows[0].id;
            }
        }
        
        // إنشاء المستخدم في قاعدة البيانات
        const newUser = await pool.query(
            `INSERT INTO users 
             (email, phone, password_hash, referral_code, referred_by, verification_token) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING id, email, phone, created_at`,
            [
                email,
                phone,
                hashedPassword,
                referralCodeUser,
                referredBy,
                jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1d' })
            ]
        );
        
        // إنشاء محفظة للمستخدم
        await pool.query(
            'INSERT INTO wallets (user_id) VALUES ($1)',
            [newUser.rows[0].id]
        );
        
        // إنشاء مستوى المستخدم
        await pool.query(
            'INSERT INTO user_levels (user_id) VALUES ($1)',
            [newUser.rows[0].id]
        );
        
        // إذا كان هناك إحالة، إنشاء سجل الإحالة
        if (referredBy) {
            await pool.query(
                'INSERT INTO referrals (referrer_id, referred_id, status) VALUES ($1, $2, $3)',
                [referredBy, newUser.rows[0].id, 'pending']
            );
        }
        
        // إرسال بريد التحقق (يجب تنفيذه في الخلفية)
        // sendVerificationEmail(email, newUser.rows[0].verification_token);
        
        res.status(201).json(newUser.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // البحث عن المستخدم
        const user = await pool.query(
            'SELECT id, email, password_hash FROM users WHERE email = $1',
            [email]
        );
        
        if (user.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // التحقق من كلمة المرور
        const isValid = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // إنشاء token
        const token = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        // إنشاء token للتجديد
        const refreshToken = jwt.sign(
            { id: user.rows[0].id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        );
        
        // تخزين token في Redis
        await redisClient.set(`user:${user.rows[0].id}:refresh`, refreshToken, {
            EX: 7 * 24 * 60 * 60 // 7 أيام
        });
        
        // تحديث آخر دخول
        await pool.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.rows[0].id]
        );
        
        res.json({ token, refreshToken });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Routes أخرى تحتاج إلى المصادقة
app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await pool.query(
            `SELECT id, email, phone, first_name, last_name, country, 
             birth_date, avatar_url, referral_code, created_at, last_login
             FROM users WHERE id = $1`,
            [req.user.id]
        );
        
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(user.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// وظيفة مساعدة لإنشاء رمز إحالة
function generateReferralCode(email) {
    return Buffer.from(email).toString('base64').slice(0, 10).replace(/[^a-zA-Z0-9]/g, '');
}
