"""
MCP server 冒烟测试：以 stdio 方式拉起 mcp_server.py，
走一遍 initialize → list_tools → call_tool 完整协议流程。

    python scripts/mcp_smoke_test.py

结果写入 scripts/_mcp_smoke_out.txt（UTF-8，规避 Windows 控制台 GBK 乱码）。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / 'scripts' / '_mcp_smoke_out.txt'


async def main() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / 'mcp_server.py')],
        cwd=str(ROOT),
    )
    sections: list[str] = []

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            sections.append('TOOLS: ' + ', '.join(names))
            assert 'search_vet_knowledge' in names, 'search tool missing'

            res = await session.call_tool(
                'search_vet_knowledge',
                {'query': '猫一直吐怎么办', 'top_k': 2, 'species': 'cat'},
            )
            text = res.content[0].text
            sections.append('SEARCH RESULT (top_k=2, species=cat):\n' + text)
            assert '[1]' in text, 'no search results returned'

            res2 = await session.call_tool('get_kb_overview', {})
            sections.append('KB OVERVIEW:\n' + res2.content[0].text)

    OUT_FILE.write_text('\n\n' + '=' * 60 + '\n\n'.join(sections), encoding='utf-8')
    print('SMOKE OK ->', OUT_FILE.name)


if __name__ == '__main__':
    asyncio.run(main())
