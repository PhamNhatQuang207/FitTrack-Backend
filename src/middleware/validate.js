const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            code: 'VALIDATION_ERROR',
            message: 'Validation Error', 
            errors: errors.array().map(err => err.msg) 
        });
    }
    next();
};

module.exports = validate;
