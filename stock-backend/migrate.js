import sql from 'mssql';
import { poolPromise } from './config/db.js';

async function migrate() {
    try {
        const pool = await poolPromise;
        if (!pool) throw new Error("Pool is null");
        console.log("Connected to SQL Server");
        
        const query = `
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Notifications]') AND type in (N'U'))
            BEGIN
                CREATE TABLE Notifications (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    UserId INT NOT NULL,
                    Message NVARCHAR(MAX) NOT NULL,
                    IsRead BIT DEFAULT 0,
                    CreatedAt DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
                );
                PRINT 'Notifications table created.';
            END
            ELSE
            BEGIN
                PRINT 'Notifications table already exists.';
            END

            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BinaryOrders]') AND type in (N'U'))
            BEGIN
                CREATE TABLE BinaryOrders (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    UserId INT NOT NULL,
                    Symbol NVARCHAR(20) NOT NULL,
                    BetAmount DECIMAL(18,2) NOT NULL,
                    BetType NVARCHAR(10) NOT NULL, -- 'UP' or 'DOWN'
                    StartPrice DECIMAL(18,6) NOT NULL,
                    EndPrice DECIMAL(18,6),
                    StartTime DATETIME DEFAULT GETUTCDATE(),
                    EndTime DATETIME NOT NULL,
                    Duration INT DEFAULT 60,
                    Status NVARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'WIN', 'LOSE', 'TIE'
                    Payout DECIMAL(18,2) DEFAULT 0,
                    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
                );
                PRINT 'BinaryOrders table created.';
            END
            ELSE
            BEGIN
                PRINT 'BinaryOrders table already exists.';
            END

            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LoginHistory]') AND type in (N'U'))
            BEGIN
                CREATE TABLE LoginHistory (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    UserId INT NOT NULL,
                    IpAddress NVARCHAR(100),
                    Device NVARCHAR(255),
                    Browser NVARCHAR(100),
                    Status NVARCHAR(50),
                    CreatedAt DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
                );
                PRINT 'LoginHistory table created.';
            END
            ELSE
            BEGIN
                PRINT 'LoginHistory table already exists.';
            END

            -- Add bank info columns to Users table if not exists
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'BankName')
            BEGIN
                ALTER TABLE Users ADD BankName NVARCHAR(200);
                PRINT 'BankName column added to Users.';
            END

            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'BankAccountNumber')
            BEGIN
                ALTER TABLE Users ADD BankAccountNumber NVARCHAR(50);
                PRINT 'BankAccountNumber column added to Users.';
            END

            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'BankAccountHolder')
            BEGIN
                ALTER TABLE Users ADD BankAccountHolder NVARCHAR(200);
                PRINT 'BankAccountHolder column added to Users.';
            END

            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[BinaryOrders]') AND name = 'Duration')
            BEGIN
                ALTER TABLE BinaryOrders ADD Duration INT DEFAULT 60;
                PRINT 'Duration column added to BinaryOrders.';
            END

            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND name = 'BankBranch')
            BEGIN
                ALTER TABLE Users ADD BankBranch NVARCHAR(200);
                PRINT 'BankBranch column added to Users.';
            END

            -- Create WithdrawRequests table
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[WithdrawRequests]') AND type in (N'U'))
            BEGIN
                CREATE TABLE WithdrawRequests (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    UserId INT NOT NULL,
                    Amount DECIMAL(18,2) NOT NULL,
                    BankName NVARCHAR(200),
                    BankAccountNumber NVARCHAR(50),
                    BankAccountHolder NVARCHAR(200),
                    BankBranch NVARCHAR(200),
                    Status NVARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
                    Note NVARCHAR(500),
                    CreatedAt DATETIME DEFAULT GETDATE(),
                    UpdatedAt DATETIME,
                    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
                );
                PRINT 'WithdrawRequests table created.';
            END
            ELSE
            BEGIN
                PRINT 'WithdrawRequests table already exists.';
            END
        `;
        
        await pool.request().query(query);
        console.log("Migration successful.");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();

