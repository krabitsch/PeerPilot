// This deployment sends no email. Account verification and password reset are
// handled without mail (auto-verify on registration; admin-driven password
// reset). The nodemailer transport and the send* helpers have been removed.

const zxcvbn = require('zxcvbn');

const validatePasswordStrength = (password) => {
    const result = zxcvbn(password);
    
    // score 0-4; 0 = very weak, 4 = very strong
    const isValid = result.score >= 3;  // require at least 'good' strength
    
    return {
        isValid,
        score: result.score,
        suggestions: result.feedback.suggestions,
        warning: result.feedback.warning,
    };
};

const jwt = require('jsonwebtoken');

const generateAccessToken = (userId, email) => {
  const expiresIn = process.env.JWT_ACCESS_EXPIRY || '15m';
  return jwt.sign({ userId, email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn });
};

// const generateAccessToken = (userId, email) => {
//     return jwt.sign({ userId, email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRY });
// };

const generateRefreshToken = (userId, email) => {
    return jwt.sign({ userId, email }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRY });
};

const verifyAccessToken = (token) => {
    return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
};

const verifyRefreshToken = (token) => {
    return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
};

module.exports = { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken, validatePasswordStrength };