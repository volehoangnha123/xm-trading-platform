import { poolPromise } from '../stock-backend/config/db.js';

async function main() {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT COUNT(*) AS total FROM BinaryOrders');
        console.log(`Total orders in DB: ${result.recordset[0].total}`);
        
        const tables = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
        console.log('Tables in DB:');
        console.log(tables.recordset.map(r => r.TABLE_NAME));
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
