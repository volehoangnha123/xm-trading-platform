import sql from 'mssql';
import { poolPromise } from '../config/db.js';
import { getPricesData, resetTrendToNeutral } from '../controllers/priceController.js';

const SETTLEMENT_INTERVAL = 5000; // Check every 5 seconds

export const startBinaryOrderJob = () => {
    setInterval(async () => {
        try {
            const pool = await poolPromise;
            if (!pool) return;

            // Get pending orders that have reached their EndTime
            const result = await pool.request().query(`
                SELECT * FROM BinaryOrders 
                WHERE Status = 'PENDING' AND EndTime <= GETUTCDATE()
            `);

            const orders = result.recordset;
            if (orders.length === 0) return;

            const pricesData = getPricesData();

            for (const order of orders) {
                const { Id, UserId, Symbol, BetAmount, BetType, StartPrice } = order;
                const currentCoin = pricesData[Symbol];
                
                if (!currentCoin) continue;

                const endPrice = currentCoin.price;
                let status = 'PENDING';
                let payout = 0;
                let profit = 0;

                // Determine win/lose/tie
                if (endPrice === StartPrice) {
                    status = 'TIE';
                    payout = BetAmount; // return original bet
                } else if (
                    (BetType === 'UP' && endPrice > StartPrice) || 
                    (BetType === 'DOWN' && endPrice < StartPrice)
                ) {
                    status = 'WIN';
                    profit = BetAmount * 0.8;
                    payout = BetAmount + profit;
                } else {
                    status = 'LOSE';
                    payout = 0;
                }

                // Process settlement in a transaction
                const transaction = new sql.Transaction(pool);
                await transaction.begin();

                try {
                    // Update order
                    await transaction.request()
                        .input('Id', sql.Int, Id)
                        .input('Status', sql.NVarChar(20), status)
                        .input('EndPrice', sql.Decimal(18, 6), endPrice)
                        .input('Payout', sql.Decimal(18, 2), payout)
                        .query(`
                            UPDATE BinaryOrders 
                            SET Status = @Status, EndPrice = @EndPrice, Payout = @Payout
                            WHERE Id = @Id
                        `);

                    // Update user balance if WIN or TIE
                    if (payout > 0) {
                        await transaction.request()
                            .input('UserId', sql.Int, UserId)
                            .input('Payout', sql.Decimal(18, 2), payout)
                            .query(`
                                UPDATE Users 
                                SET Balance = Balance + @Payout 
                                WHERE Id = @UserId
                            `);
                    }

                    // Send notification to customer
                    let notifyMsg = '';
                    if (status === 'WIN') {
                        const profit = BetAmount * 0.8;
                        notifyMsg = `Lệnh quyền chọn ${Symbol} (${BetType === 'UP' ? 'Mua' : 'Bán'}) đã kết toán: Thắng. Số dư được cộng: +$${payout.toFixed(2)} (Lợi nhuận: +$${profit.toFixed(2)}).`;
                    } else if (status === 'LOSE') {
                        notifyMsg = `Lệnh quyền chọn ${Symbol} (${BetType === 'UP' ? 'Mua' : 'Bán'}) đã kết toán: Thua. Số dư bị trừ: -$${BetAmount.toFixed(2)}.`;
                    } else if (status === 'TIE') {
                        notifyMsg = `Lệnh quyền chọn ${Symbol} (${BetType === 'UP' ? 'Mua' : 'Bán'}) đã kết toán: Hòa. Hoàn trả cược: +$${payout.toFixed(2)}.`;
                    }

                    await transaction.request()
                        .input('UserId', sql.Int, UserId)
                        .input('Message', sql.NVarChar, notifyMsg)
                        .input('CreatedAt', sql.DateTime, new Date())
                        .query(`
                            INSERT INTO Notifications (UserId, Message, CreatedAt) 
                            VALUES (@UserId, @Message, @CreatedAt)
                        `);

                    await transaction.commit();

                    console.log(`[Binary Options] Order ${Id} settled. Type: ${BetType}, Start: ${StartPrice}, End: ${endPrice}. Result: ${status}. Payout: ${payout}`);
                        
                } catch (err) {
                    await transaction.rollback();
                    console.error(`[Binary Options] Error settling order ${Id}:`, err);
                }
            }

            // Check if any symbols have finished all their pending orders, and reset their trend to neutral
            const symbolsChecked = [...new Set(orders.map(o => o.Symbol))];
            for (const sym of symbolsChecked) {
                const countRes = await pool.request()
                    .input('symbol', sql.NVarChar(20), sym)
                    .query("SELECT COUNT(*) AS PendingCount FROM BinaryOrders WHERE Symbol = @symbol AND Status = 'PENDING'");
                const count = countRes.recordset[0].PendingCount;
                if (count === 0) {
                    resetTrendToNeutral(sym);
                    console.log(`[Binary Options] All bets for ${sym} settled. Resetting trend to neutral.`);
                }
            }
        } catch (err) {
            console.error('[Binary Options] Error in settlement job:', err);
        }
    }, SETTLEMENT_INTERVAL);
    
    console.log('[Binary Options] Background settlement job started.');
};
