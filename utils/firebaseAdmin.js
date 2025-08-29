// firebaseAdmin.js
const admin = require('firebase-admin');

// Ensure the path is correct relative to this file
const serviceAccount = require('../diamondsoftware-91a0c-firebase-adminsdk-fbsvc-d04bc120e9.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'diamondsoftware-91a0c',
    databaseURL: 'https://diamondsoftware-91a0c.firebaseio.com'
});

module.exports = admin;