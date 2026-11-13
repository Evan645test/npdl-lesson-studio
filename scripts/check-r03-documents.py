import hashlib
import json
import pathlib
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
import pymupdf

folder = pathlib.Path(sys.argv[1]).resolve()
records = []
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
for width in [1440, 390, 320]:
    for audience in ['student', 'teacher']:
        path = folder / f'{audience}-{width}.docx'
        with zipfile.ZipFile(path) as archive:
            assert archive.testzip() is None
            assert '[Content_Types].xml' in archive.namelist()
            xml = ET.fromstring(archive.read('word/document.xml'))
            text = '\n'.join(node.text or '' for node in xml.findall('.//w:t', ns))
            for marker in ['前測：生活情境能力題', '後測第一部分', '後測第二部分', '後測第三部分', '目前沒有足夠課程證據']:
                assert marker in text, (path.name, marker)
            assert 'sk-isolated-browser-test-key' not in text
            if audience == 'student':
                assert '可支持：' not in text and '完整教師判讀提示詞' not in text
            else:
                for marker in ['工具四階完整規準', '可支持：', '不支持／限制：', '多題整合規則', '完整教師判讀提示詞', '分母']:
                    assert marker in text, (path.name, marker)
        opened = subprocess.run(['textutil', '-convert', 'txt', '-stdout', str(path)], capture_output=True, check=True).stdout.decode('utf-8')
        assert '後測第三部分' in opened
        records.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'zipCRC': 'passed', 'OOXML': 'passed', 'macOSTextutilOpen': 'passed', 'threeParts': 'passed'})
        pdf_path = folder / f'{audience}-{width}.pdf'
        with pymupdf.open(pdf_path) as document:
            assert 1 <= document.page_count <= 120
            for page in document:
                assert len(page.get_images()) > 0
                assert page.rect.width > 500 and page.rect.height > 800
            selected = sorted(set([0, document.page_count // 2, document.page_count - 1]))
            if width == 1440:
                for index in selected:
                    document[index].get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2), alpha=False).save(str(folder / f'{audience}-pdf-page-{index+1}.png'))
            records.append({'file': pdf_path.name, 'bytes': pdf_path.stat().st_size, 'sha256': hashlib.sha256(pdf_path.read_bytes()).hexdigest(), 'open': 'passed', 'pages': document.page_count, 'pageImages': 'passed', 'representativePages': [i+1 for i in selected], 'visualInspection': 'pending'})
(folder / 'documents-check.json').write_text(json.dumps({'status': 'structural-passed', 'files': records}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'structural-passed', 'files': len(records), 'pdfPages': {r['file']: r['pages'] for r in records if 'pages' in r}}, ensure_ascii=False))
