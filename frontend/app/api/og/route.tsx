import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const restaurant = searchParams.get('restaurant') || 'Bill Split';
    const total = searchParams.get('total') || '0';
    const participants = searchParams.get('participants') || '0';
    const roast = searchParams.get('roast') || '';

    return new ImageResponse(
        (
            <div
                style={{
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#09090b',
                    backgroundImage: 'linear-gradient(to bottom right, #064e3b22, #09090b, #09090b)',
                    fontFamily: 'system-ui, sans-serif',
                    padding: '40px',
                }}
            >
                {/* Logo area */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '24px',
                    }}
                >
                    <div
                        style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '12px',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '24px',
                            color: 'black',
                            fontWeight: 900,
                        }}
                    >
                        B
                    </div>
                    <span style={{ color: '#a1a1aa', fontSize: '20px', fontWeight: 600 }}>
                        Bro Please Pay
                    </span>
                </div>

                {/* Restaurant name */}
                <div
                    style={{
                        fontSize: '52px',
                        fontWeight: 900,
                        color: 'white',
                        marginBottom: '16px',
                        textAlign: 'center',
                        maxWidth: '90%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {restaurant}
                </div>

                {/* Stats row */}
                <div
                    style={{
                        display: 'flex',
                        gap: '40px',
                        marginBottom: '32px',
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: '36px', fontWeight: 800, color: '#10b981' }}>
                            ₹{total}
                        </span>
                        <span style={{ fontSize: '14px', color: '#71717a' }}>total bill</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: '36px', fontWeight: 800, color: '#a78bfa' }}>
                            {participants}
                        </span>
                        <span style={{ fontSize: '14px', color: '#71717a' }}>bros splitting</span>
                    </div>
                </div>

                {/* AI Roast */}
                {roast && (
                    <div
                        style={{
                            maxWidth: '80%',
                            padding: '16px 24px',
                            borderRadius: '16px',
                            border: '1px solid #f9731633',
                            backgroundColor: '#f9731611',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}
                    >
                        <span style={{ fontSize: '24px' }}>🔥</span>
                        <span
                            style={{
                                fontSize: '16px',
                                color: '#fdba74',
                                lineHeight: 1.4,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {roast.length > 120 ? roast.slice(0, 120) + '...' : roast}
                        </span>
                    </div>
                )}
            </div>
        ),
        {
            width: 1200,
            height: 630,
        },
    );
}
