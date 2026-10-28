"""Reveal the live controls used by the existing behavior suites."""


def open_live_sections(page):
    page.wait_for_function("document.body.dataset.ready === 'true'")
    for section in page.locator('aside > details.control-section').all():
        if not section.evaluate('(el) => el.open'):
            section.locator(':scope > summary').click()


def open_control(page, selector):
    """Open native disclosures from the outside in, using their real summaries."""
    ancestors = page.locator(selector).locator('xpath=ancestor::details')
    for section in ancestors.all():
        if not section.evaluate('(el) => el.open'):
            section.locator(':scope > summary').click()
