const axios = require('axios');

const API_URL = 'http://localhost:5000/api';

const runTests = async () => {
    console.log('🛡️ Starting Security Verification...');

    // 1. Test Validation (Invalid Email)
    try {
        console.log('\n1️⃣ Testing Input Validation (Expect 400)...');
        await axios.post(`${API_URL}/auth/register`, {
            name: 'Test',
            email: 'invalid-email',
            password: '123'
        });
        console.log('❌ Failed: Invalid email was accepted.');
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log('✅ Passed: Invalid payload rejected (400).');
            console.log('Errors:', error.response.data.errors);
        } else {
            console.log('❌ Failed: Unexpected status:', error.response ? error.response.status : error.message);
        }
    }

    // 2. Test NoSQL Injection Attempt (Sanitization)
    try {
        console.log('\n2️⃣ Testing NoSQL Injection (Expect 400 or Sanitize)...');
        // sending object as password: { $ne: null }
        await axios.post(`${API_URL}/auth/login`, {
            email: 'admin@example.com',
            password: { "$ne": null }
        });
        console.log('❌ Failed: Injection payload might have been processed raw.');
    } catch (error) {
         if (error.response && error.response.status === 400) {
            console.log('✅ Passed: Injection payload rejected/validated (400).');
        } else {
            console.log('ℹ️ Received:', error.response ? error.response.status : error.message);
        }
    }

    // 3. Check Headers
    try {
        console.log('\n3️⃣ Checking Security Headers...');
        const res = await axios.get(`${API_URL}/health`);
        const headers = res.headers;
        
        if (headers['x-dns-prefetch-control'] || headers['strict-transport-security'] || headers['content-security-policy']) {
             console.log('✅ Passed: Helmet headers detected.');
        } else {
             console.log('❌ Failed: No basic security headers found.');
        }
    } catch (error) {
        console.log('❌ Failed to connect for header check:', error.message);
    }
};

runTests();
