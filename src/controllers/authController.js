const { getDb } = require('../config/db');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');

const register = async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const db = getDb();

        // Check if user already exists
        const userExists = await db.collection('users').findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Create new user
        const newUser = {
            email,
            password: hashedPassword,
            name,
            isVerified: false,
            verificationToken,
            createdAt: new Date()
        };

        const result = await db.collection('users').insertOne(newUser);
        
        // Send verification email
        const verificationUrl = `http://localhost:3000/verify-email/${verificationToken}`;
        
        try {
            await sendEmail({
                to: email,
                subject: 'Welcome to FitTrack - Verify Your Email',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h1 style="color: #3b82f6;">Welcome to FitTrack!</h1>
                        <p>Hi ${name},</p>
                        <p>Thank you for registering with FitTrack. To complete your registration, please verify your email address by clicking the button below:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${verificationUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
                        </div>
                        <p>Or copy and paste this link into your browser:</p>
                        <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
                        <p>This link will expire in 24 hours.</p>
                        <p>If you didn't create an account with FitTrack, please ignore this email.</p>
                        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                        <p style="color: #999; font-size: 12px;">FitTrack - Your Fitness Journey Starts Here</p>
                    </div>
                `,
                text: `Welcome to FitTrack! Please verify your email by visiting: ${verificationUrl}`
            });
        } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
            // Continue registration even if email fails
        }
        
        res.status(201).json({ 
            message: 'Registration successful! Please check your email to verify your account.',
            userId: result.insertedId 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = getDb();

        // Find user by email
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Check if email is verified
        if (user.isVerified === false) {
            return res.status(401).json({ message: 'Please verify your email before logging in' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Create JWT token
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            userId: user._id,
            name: user.name
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyEmail = async (req, res) => {
    try {
        const { token } = req.params;
        const db = getDb();

        // Find user by verification token
        const user = await db.collection('users').findOne({ verificationToken: token });
        
        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired verification token' });
        }

        // Check if already verified
        if (user.isVerified) {
            return res.status(200).json({ message: 'Email already verified. You can now log in.' });
        }

        // Update user: set verified and remove token
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { isVerified: true },
                $unset: { verificationToken: '' }
            }
        );

        res.status(200).json({ message: 'Email verified successfully! You can now log in.' });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ message: error.message });
    }
};

const requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        const db = getDb();

        // Find user by email
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            // Don't reveal if user exists or not for security
            return res.status(200).json({ message: 'If an account exists with that email, a password reset link has been sent.' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

        // Save reset token to user
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: {
                    resetPasswordToken: resetToken,
                    resetPasswordExpiry: resetTokenExpiry
                }
            }
        );

        // Send reset email
        const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;

        try {
            await sendEmail({
                to: email,
                subject: 'FitTrack - Password Reset Request',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h1 style="color: #3b82f6;">Password Reset Request</h1>
                        <p>Hi ${user.name},</p>
                        <p>You requested to reset your password for your FitTrack account.</p>
                        <p>Click the button below to reset your password:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
                        </div>
                        <p>Or copy and paste this link into your browser:</p>
                        <p style="color: #666; word-break: break-all;">${resetUrl}</p>
                        <p><strong>This link will expire in 1 hour.</strong></p>
                        <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
                        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                        <p style="color: #999; font-size: 12px;">FitTrack - Your Fitness Journey Starts Here</p>
                    </div>
                `,
                text: `Reset your password by visiting: ${resetUrl}`
            });
        } catch (emailError) {
            console.error('Failed to send password reset email:', emailError);
        }

        res.status(200).json({ message: 'If an account exists with that email, a password reset link has been sent.' });
    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ message: error.message });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;
        const db = getDb();

        // Find user by reset token and check expiry
        const user = await db.collection('users').findOne({
            resetPasswordToken: token,
            resetPasswordExpiry: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired reset token' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update password and remove reset token
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { password: hashedPassword },
                $unset: { resetPasswordToken: '', resetPasswordExpiry: '' }
            }
        );

        res.status(200).json({ message: 'Password reset successful! You can now log in with your new password.' });
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { register, login, verifyEmail, requestPasswordReset, resetPassword };