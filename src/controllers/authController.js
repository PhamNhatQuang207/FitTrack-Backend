const { getDb } = require('../config/db');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmailSmart');

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
        const verificationUrl = `https://fit-track-frontend-gray.vercel.app/verify-email?token=${verificationToken}`;
        
        try {
            await sendEmail({
                to: email,
                subject: '🎯 Welcome to FitTrack - Verify Your Email',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                            <!-- Header with gradient -->
                            <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center;">
                                <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold;">🏋️ FitTrack</h1>
                                <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 16px;">Your Fitness Journey Starts Here</p>
                            </div>
                            
                            <!-- Content -->
                            <div style="padding: 40px 30px;">
                                <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 24px;">Welcome, ${name}! 👋</h2>
                                
                                <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                                    Thank you for joining FitTrack! We're excited to help you achieve your fitness goals.
                                </p>
                                
                                <p style="margin: 0 0 30px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                                    To get started, please verify your email address by clicking the button below:
                                </p>
                                
                                <!-- CTA Button -->
                                <div style="text-align: center; margin: 40px 0;">
                                    <a href="${verificationUrl}" 
                                       style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.3);">
                                        Verify Email Address
                                    </a>
                                </div>
                                
                                <!-- Alternative Link -->
                                <div style="margin: 30px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border-left: 4px solid #3b82f6;">
                                    <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
                                        <strong>Or copy and paste this link:</strong>
                                    </p>
                                    <p style="margin: 0; color: #3b82f6; font-size: 14px; word-break: break-all;">
                                        ${verificationUrl}
                                    </p>
                                </div>
                                
                                <!-- Info Box -->
                                <div style="margin: 30px 0; padding: 15px; background-color: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
                                    <p style="margin: 0; color: #92400e; font-size: 14px;">
                                        ⏱️ <strong>Important:</strong> This verification link will expire in 24 hours.
                                    </p>
                                </div>
                                
                                <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                                    If you didn't create a FitTrack account, you can safely ignore this email.
                                </p>
                            </div>
                            
                            <!-- Footer -->
                            <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                                <p style="margin: 0 0 10px 0; color: #9ca3af; font-size: 14px;">
                                    FitTrack - Track Your Progress, Achieve Your Goals
                                </p>
                                <p style="margin: 0; color: #d1d5db; font-size: 12px;">
                                    © 2026 FitTrack. All rights reserved.
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                `,
                text: `Welcome to FitTrack, ${name}! Please verify your email by visiting: ${verificationUrl}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account, you can ignore this email.`
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
        const resetUrl = `https://fit-track-frontend-gray.vercel.app/reset-password?token=${resetToken}`;

        try {
            await sendEmail({
                to: email,
                subject: '🔒 FitTrack - Password Reset Request',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                            <!-- Header -->
                            <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center;">
                                <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold;">🏋️ FitTrack</h1>
                                <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 16px;">Password Reset Request</p>
                            </div>
                            
                            <!-- Content -->
                            <div style="padding: 40px 30px;">
                                <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 24px;">Hi, ${user.name}!</h2>
                                
                                <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                                    You requested to reset your password for your FitTrack account.
                                </p>
                                
                                <p style="margin: 0 0 30px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                                    Click the button below to create a new password:
                                </p>
                                
                                <!-- CTA Button -->
                                <div style="text-align: center; margin: 40px 0;">
                                    <a href="${resetUrl}" 
                                       style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.3);">
                                        Reset Password
                                    </a>
                                </div>
                                
                                <!-- Alternative Link -->
                                <div style="margin: 30px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border-left: 4px solid #3b82f6;">
                                    <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
                                        <strong>Or copy and paste this link:</strong>
                                    </p>
                                    <p style="margin: 0; color: #3b82f6; font-size: 14px; word-break: break-all;">
                                        ${resetUrl}
                                    </p>
                                </div>
                                
                                <!-- Warning Box -->
                                <div style="margin: 30px 0; padding: 15px; background-color: #fee2e2; border-radius: 8px; border-left: 4px solid #dc2626;">
                                    <p style="margin: 0; color: #7f1d1d; font-size: 14px;">
                                        ⏱️ <strong>Important:</strong> This password reset link will expire in 1 hour.
                                    </p>
                                </div>
                                
                                <p style="margin: 30px 0 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                                    If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
                                </p>
                            </div>
                            
                            <!-- Footer -->
                            <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                                <p style="margin: 0 0 10px 0; color: #9ca3af; font-size: 14px;">
                                    FitTrack - Track Your Progress, Achieve Your Goals
                                </p>
                                <p style="margin: 0; color: #d1d5db; font-size: 12px;">
                                    © 2026 FitTrack. All rights reserved.
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                `,
                text: `Password Reset Request\n\nHi ${user.name},\n\nYou requested to reset your password for your FitTrack account. Please visit the following link to create a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, you can ignore this email.`
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